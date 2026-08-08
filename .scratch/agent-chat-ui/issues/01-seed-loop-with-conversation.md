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

**Status:** done

- [x] `runAgent` accepts the conversation to start from instead of a single question,
      and still returns the full conversation
- [x] A Message can carry the system role, and the loop passes it to the Model ahead
      of the conversation
- [x] The loop stops after 10 iterations and reports why, rather than continuing until
      the deadline fires
- [x] `npm run cli "<question>"` behaves exactly as it did before this ticket,
      including on failure, where it still prints the conversation
- [x] `npm run typecheck` passes

## Comments

The 10-iteration cap matters locally, not just in production — a model that loops on
tool calls currently burns credits until the 60s deadline.

---

Landed as `runAgent(conversation: readonly Message[], deps)`. It copies the seed, appends
to it, and returns the whole thing; the seed is *not* re-announced through
`observer.onMessage`, since the caller already holds those messages. `main.ts` builds the
one-message seed and pre-fills its own `conversation` array with it, so a failed run still
prints the question.

Deviation worth knowing: the system prompt is `deps.systemPrompt?: string`, not a message
the caller prepends. The `Message` union does gain a `"system"` role — the loop builds that
message and sends it ahead of the conversation on every turn — but it stays out of the
returned conversation. Reasoning: a workflow is `{ systemPrompt, modelId, toolNames }` and
the other two resolve to dependencies, so this one is configuration too, and the
`UIMessage` → `Message` adapter never has to invent or filter a system message.

The cap is a module-private `MAX_ITERATIONS = 10` and reports itself through a new
`AgentObserver.onGaveUp(iterations)`. It does not throw: the run ends normally with a
usable conversation, and the caller decides how loud to be. `consoleObserver` prints
`[gave up] still asking for tools after 10 turns — stopping here`.

Verified with a scripted `ModelPort` (no network, no keys): seed returned intact, system
message first in what the model receives, exactly 10 model calls before `onGaveUp(10)`.
`npm run cli "What is 17 + 25?"` produces byte-identical output to before.
