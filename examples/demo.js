const { ConversationMemory } = require("../dist/index.js");

const evictedLog = [];

const memory = new ConversationMemory({
  tokenBudget: 40, // deliberately tiny to force eviction in this demo
  onEvict: (message) => {
    evictedLog.push(message);
    console.log(`[evict] #${message.id} (${message.role}): "${message.content.slice(0, 40)}"`);
  },
});

memory.addMessage({ role: "system", content: "You are a helpful assistant. Always be concise.", pinned: true });
memory.addMessage({ role: "user", content: "My favorite color is teal and I live in Portland." });
memory.addMessage({ role: "assistant", content: "Got it, teal is a great color and Portland is lovely." });
memory.addMessage({ role: "user", content: "What's a good gift idea for someone who loves hiking?" });
memory.addMessage({ role: "assistant", content: "Consider a lightweight trekking pole set or a hydration pack." });
memory.addMessage({ role: "user", content: "Actually let's talk about something else: quantum computing basics." });

console.log("\n--- active window (pinned + recent, within budget) ---");
for (const m of memory.getMessages()) {
  console.log(`#${m.id} pinned=${!!m.pinned} (${m.role}): "${m.content.slice(0, 50)}"`);
}
console.log("active tokens:", memory.activeTokens(), "/ budget 40");

console.log("\n--- eviction order ---");
console.log(evictedLog.map((m) => m.id));

console.log("\n--- recall an evicted fact ('teal') ---");
console.log(memory.recall("teal"));

console.log("\n--- export/import round-trip ---");
const exported = memory.exportJSON();
const restored = new ConversationMemory({ tokenBudget: 40 });
restored.importJSON(exported);
console.log("restored active count:", restored.getMessages().length, "evicted count:", restored.getEvicted().length);
console.log("restored recall('teal'):", restored.recall("teal").length, "match(es)");
