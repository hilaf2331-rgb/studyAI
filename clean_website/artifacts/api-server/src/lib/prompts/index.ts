// The Dispatcher. getSystemPrompt() will run a lightweight keyword check
// against the material content and return the matching category's prompt
// object, falling back to base.ts's General prompt when nothing matches.
// Category modules (vocab.ts done; stem/programming/legal/historical next)
// plug in here -- this file stays a thin router, no prompt text of its own.
export {};
