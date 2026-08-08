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

**Status:** done

- [x] Asking an arithmetic question shows the calculate Tool Call with its arguments,
      then its result, then the answer
- [x] Asking a current-events question shows the search Tool Call and its result
- [x] A question needing several tool calls shows them in order, with turn boundaries
      distinguishable
- [x] A follow-up question is answered in the context of the conversation so far
- [x] A tool that throws shows an error in place of its result and the conversation
      remains usable
- [x] It is possible to tell apart "the model is working", "a tool is running", and
      "the answer is arriving"
- [x] The CLI still answers the same questions the same way

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

---

**Built.** `src/adapters/ui-stream-renderer.ts` is the second `AgentObserver`, sitting
beside `console-renderer.ts`; `src/adapters/ui-message-history.ts` is the UIMessage →
Message adapter. `app/api/chat/route.ts` is composition root #2 and makes the same three
calls `src/main.ts` does. The Agent Loop, the domain `Message` type and the CLI are
untouched — the CLI was re-run and answers the same questions the same way.

The chunk protocol, one run: `start`, then per Turn a `start-step` (the turn boundary,
written before the turn's content so a step holds exactly one turn), then
`text-start`/`text-delta`/`text-end` if that turn said anything, then
`tool-input-available` and later `tool-output-available` per Tool Call — every tool chunk
carrying `dynamic: true` — and finally `finish`. Tool output is `{ result, durationMs }`,
because how long a tool took is most of the reason to watch it.

Three deviations worth naming:

1. **A thrown tool ends the run.** The loop has no "a tool threw" hook and `dispatch` does
   not catch, so a throw leaves the loop entirely; not changing the loop was the harder
   constraint. The renderer therefore tracks in-flight Tool Calls and, from its terminal
   `end(error)`, closes them out as `tool-output-error` and writes an `error` chunk.
   Verified against a deliberately broken Tavily key: the failed `web_search` card shows
   the error where its result would be, the transcript stays on screen, and the next
   question is answered normally. The stronger reading — the agent carrying on past a
   failed tool — needs either a loop change or an adapter that turns tool throws into tool
   results, and the second would make the browser and the CLI answer differently. Left for
   whoever wants it.
2. **`tsconfig.json` moved to `nodenext` module resolution** (and `app/`'s own relative
   imports gained `.js` extensions to match). Turbopack only rewrites the domain's `.js`
   import specifiers to `.ts` when the project resolves the way Node does; under the
   scaffolded `bundler` setting the route 500s with "Module not found: Can't resolve
   `../domain/errors.js`". `experimental.extensionAlias` was tried first — webpack-only,
   Turbopack ignores it. `package.json` was not touched.
3. **"The answer is arriving" is real but brief**, since the text still arrives whole. All
   three states were observed in a real browser at DOM-mutation granularity; ticket 07 is
   what gives the third one duration.
