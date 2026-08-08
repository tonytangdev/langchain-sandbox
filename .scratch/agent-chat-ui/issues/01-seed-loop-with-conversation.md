# 01 — Seed the loop with a conversation and a system message

**What to build:** The Agent Loop is driven by a conversation rather than a single
question, can be given instructions before that conversation starts, and stops
running away.

Today `runAgent` takes one question string, builds a one-message conversation from it
internally, and loops without an upper bound. A chat interface sends a whole history
and a Workflow needs to tell the agent what it is, so the loop must accept both. This
is a prefactor: nothing user-visible changes, but everything downstream depends on it.

From the outside, the CLI still answers a one-shot question exactly as it does now.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] `runAgent` accepts the conversation to start from instead of a single question,
      and still returns the full conversation
- [ ] A Message can carry the system role, and the loop passes it to the Model ahead
      of the conversation
- [ ] The loop stops after 10 iterations and reports why, rather than continuing until
      the deadline fires
- [ ] `npm run cli "<question>"` behaves exactly as it did before this ticket,
      including on failure, where it still prints the conversation
- [ ] `npm run typecheck` passes

## Comments

The 10-iteration cap matters locally, not just in production — a model that loops on
tool calls currently burns credits until the 60s deadline.
