# 06 — The real agent answers, with visible tool calls

**What to build:** The chat page talks to the actual Agent Loop, and every Tool Call is
visible as it happens.

Asking a question runs the real agent. Each Tool Call appears the moment the Model
requests it, showing which tool and what arguments it chose; each result appears when
it returns. A tool that fails shows its error in place of a result, and the agent
carries on rather than the conversation dying. Follow-up questions work — the agent
remembers what was already said.

The answer text still arrives whole; streaming it token by token is ticket 07. Turn
boundaries are visible, so a multi-step answer reads as a sequence rather than a blur.

**Blocked by:** 01, 03, 05

**Status:** ready-for-agent

- [ ] Asking an arithmetic question shows the calculate Tool Call with its arguments,
      then its result, then the answer
- [ ] Asking a current-events question shows the search Tool Call and its result
- [ ] A question needing several tool calls shows them in order, with turn boundaries
      distinguishable
- [ ] A follow-up question is answered in the context of the conversation so far
- [ ] A tool that throws shows an error in place of its result and the conversation
      remains usable
- [ ] It is possible to tell apart "the model is working", "a tool is running", and
      "the answer is arriving"
- [ ] The CLI still answers the same questions the same way

## Comments

The streaming renderer is a second implementation of the existing observer interface —
the same one the console renderer implements. Its hooks already cover token, turn,
tool-call-start and tool-call-end. The Agent Loop itself does not change.

Tool chunks should be marked dynamic, so the client materialises them as
runtime-named tool parts. The statically-typed alternative requires tool names known
at compile time, and a workflow-selected toolset is chosen at runtime.

Writing to the stream is synchronous and fire-and-forget, so it can be called straight
from the observer callbacks with no ordering hazard. The handler's promise must be
resolved from the loop's terminal callback, on every path.

Converting the incoming web message history to domain Messages is a hand-written
adapter. The SDK's own model-message types are not needed — the contract is its UI
message type in and its stream chunks out, so the domain Message type stays untouched.
