# agent-conversation-memory

Bounded conversation memory for LLM agents — token-budget rolling window
(not message count), pinned messages that never evict, an eviction
callback enabling the summarize-and-reinsert pattern, keyword recall over
evicted history, and JSON export/import. Zero runtime dependencies,
strict TypeScript.

## Quickstart

```ts
import { ConversationMemory } from "agent-conversation-memory";

const memory = new ConversationMemory({
  tokenBudget: 4000,
  onEvict: (message) => {
    // Summarize-and-reinsert pattern — you own the summarizer, this
    // library never calls an LLM itself.
    const summary = mySummarizer(message);
    memory.addMessage({ role: "system", content: summary, pinned: false });
  },
});

memory.addMessage({ role: "system", content: "You are a helpful assistant.", pinned: true });
memory.addMessage({ role: "user", content: "My favorite color is teal." });
// ... conversation continues, oldest non-pinned messages evict as the budget fills ...

memory.getMessages();      // current active window
memory.recall("teal");     // find evicted messages even after they've scrolled out
```

## API

### `new ConversationMemory(options)`

```ts
interface ConversationMemoryOptions {
  tokenBudget: number;              // max total estimated tokens across active messages
  estimateTokens?: TokenEstimator;  // defaults to a built-in chars/4 heuristic
  onEvict?: EvictionCallback;       // called once per message right after eviction
}
```

### `addMessage(input): Message`

`input: { role, content, pinned? }`. Adds a message, then evicts the
oldest **non-pinned** active messages (in insertion order) until back
within `tokenBudget`. Pinned messages are always skipped by eviction.

### `getMessages(): Message[]`

The current active window, in original insertion order.

### `getEvicted(): Message[]`

All messages evicted so far, in eviction order (oldest evicted first).

### `recall(keyword): RecallResult[]`

Case-insensitive, whole-word keyword search over evicted history, via an
inverted index built at eviction time. Returns
`{ message, matchedKeywords }[]`, sorted by original message id.

### `activeTokens(): number`

Total estimated tokens currently in the active window.

### `exportJSON(): string` / `importJSON(json: string): void`

Round-trip the full state (active + evicted + recall index rebuild).

### `defaultEstimateTokens(text): number`

The built-in `chars/4` estimator, exported for reuse or comparison
against a custom `estimateTokens`.

## Limits

- Token estimation defaults to a rough `chars/4` heuristic — pass your own
  `estimateTokens` for anything precision-sensitive (see the sibling
  `token-estimator` package for a fuller heuristic).
- **No LLM calls, ever.** The eviction callback is a hook, not a
  summarizer — you must supply your own summarization function if you
  want the summarize-and-reinsert pattern.
- `recall()` only searches **evicted** history via keyword match (whole
  words, case-insensitive) — it is not semantic search and does not
  search the active window (which you already have via `getMessages()`).
- `importJSON` re-fires `onEvict` for every restored evicted message,
  since it rebuilds the recall index through the same eviction path —
  guard your callback if that side effect matters during import.

---
Part of the [ferrow-toolkit](https://github.com/Ruzylo-cloud/ferrow-toolkit) collection · Sponsored by [Ferrow](https://ferrow.ai)
