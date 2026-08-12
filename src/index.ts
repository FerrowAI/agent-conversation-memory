/**
 * agent-conversation-memory
 *
 * Bounded conversation memory for LLM agents: a rolling message window
 * sized by estimated-token budget (not message count), pinned messages
 * that never evict (e.g. the system prompt), an eviction callback that
 * enables the summarize-and-reinsert pattern (you supply the summarizer
 * function — this library makes no LLM calls itself), keyword recall
 * search over evicted history via an inverted index, and JSON export /
 * import. Zero runtime dependencies.
 */

export interface Message {
  id: number;
  role: string;
  content: string;
  /** Pinned messages are never evicted by the rolling window. */
  pinned?: boolean;
  /** Set automatically at add time if not provided. */
  timestamp?: number;
}

export type AddMessageInput = Omit<Message, "id" | "timestamp"> & { timestamp?: number };

export type TokenEstimator = (text: string) => number;

/** Tiny built-in chars/4 token estimator, used when no estimator is supplied. */
export const defaultEstimateTokens: TokenEstimator = (text: string) =>
  text.length === 0 ? 0 : Math.max(1, Math.round(text.length / 4));

export type EvictionCallback = (message: Message) => void;

export interface ConversationMemoryOptions {
  /** Max total estimated tokens across all active (non-evicted) messages. */
  tokenBudget: number;
  /** Custom token estimator; defaults to a chars/4 heuristic. */
  estimateTokens?: TokenEstimator;
  /** Called once per message right after it is evicted from the active window. */
  onEvict?: EvictionCallback;
}

export interface RecallResult {
  message: Message;
  matchedKeywords: string[];
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((w) => w.length > 0);
}

/**
 * Bounded conversation memory: active messages stay within a token
 * budget via oldest-first eviction (pinned messages excluded), evicted
 * messages remain keyword-searchable via an inverted index, and the
 * whole active state round-trips through JSON.
 */
export class ConversationMemory {
  private tokenBudget: number;
  private estimateTokens: TokenEstimator;
  private onEvict?: EvictionCallback;

  private active: Message[] = [];
  private evicted: Message[] = [];
  private index = new Map<string, Set<number>>();
  private evictedById = new Map<number, Message>();
  private nextId = 1;

  constructor(options: ConversationMemoryOptions) {
    if (options.tokenBudget <= 0) {
      throw new RangeError("ConversationMemory: tokenBudget must be > 0");
    }
    this.tokenBudget = options.tokenBudget;
    this.estimateTokens = options.estimateTokens ?? defaultEstimateTokens;
    this.onEvict = options.onEvict;
  }

  /** Estimated token count of a message (role wrapper not counted, content only). */
  private messageTokens(m: Message): number {
    return this.estimateTokens(m.content);
  }

  /** Total estimated tokens of the current active window. */
  activeTokens(): number {
    return this.active.reduce((sum, m) => sum + this.messageTokens(m), 0);
  }

  /** Add a message. Evicts oldest non-pinned active messages as needed to stay within budget. */
  addMessage(input: AddMessageInput): Message {
    const message: Message = {
      id: this.nextId++,
      role: input.role,
      content: input.content,
      pinned: input.pinned ?? false,
      timestamp: input.timestamp ?? Date.now(),
    };

    this.active.push(message);
    this.evictAsNeeded();
    return message;
  }

  private evictAsNeeded(): void {
    let total = this.activeTokens();
    if (total <= this.tokenBudget) return;

    // Evict oldest non-pinned messages first, in insertion order, until
    // back within budget (or nothing left to evict).
    let i = 0;
    while (total > this.tokenBudget && i < this.active.length) {
      const candidate = this.active[i];
      if (candidate.pinned) {
        i++;
        continue;
      }
      this.active.splice(i, 1);
      total -= this.messageTokens(candidate);
      this.evict(candidate);
      // Do not advance i: the array shifted left.
    }
  }

  private evict(message: Message): void {
    this.evicted.push(message);
    this.evictedById.set(message.id, message);
    for (const word of tokenize(message.content)) {
      let set = this.index.get(word);
      if (!set) {
        set = new Set();
        this.index.set(word, set);
      }
      set.add(message.id);
    }
    this.onEvict?.(message);
  }

  /** Current active window, in original insertion order (pinned and unpinned interleaved as added). */
  getMessages(): Message[] {
    return [...this.active];
  }

  /** All messages evicted so far, in eviction order. */
  getEvicted(): Message[] {
    return [...this.evicted];
  }

  /** Keyword recall search over evicted history via the inverted index. Case-insensitive, whole-word. */
  recall(keyword: string): RecallResult[] {
    const words = tokenize(keyword);
    if (words.length === 0) return [];

    const matchedIds = new Map<number, Set<string>>();
    for (const word of words) {
      const ids = this.index.get(word);
      if (!ids) continue;
      for (const id of ids) {
        let matched = matchedIds.get(id);
        if (!matched) {
          matched = new Set();
          matchedIds.set(id, matched);
        }
        matched.add(word);
      }
    }

    return [...matchedIds.entries()]
      .map(([id, matched]) => ({
        message: this.evictedById.get(id)!,
        matchedKeywords: [...matched],
      }))
      .sort((a, b) => a.message.id - b.message.id);
  }

  /** Export active + evicted state as a JSON string. */
  exportJSON(): string {
    return JSON.stringify({
      tokenBudget: this.tokenBudget,
      nextId: this.nextId,
      active: this.active,
      evicted: this.evicted,
    });
  }

  /** Replace this memory's entire state from a previously exported JSON string. Rebuilds the recall index. */
  importJSON(json: string): void {
    const parsed = JSON.parse(json) as {
      tokenBudget: number;
      nextId: number;
      active: Message[];
      evicted: Message[];
    };
    this.tokenBudget = parsed.tokenBudget;
    this.nextId = parsed.nextId;
    this.active = parsed.active;
    this.evicted = [];
    this.evictedById.clear();
    this.index.clear();
    for (const m of parsed.evicted) {
      this.evict(m);
    }
    // evict() calls onEvict for each restored message too; callers that
    // don't want that during import should not pass onEvict, or should
    // guard it against re-processing.
  }
}
