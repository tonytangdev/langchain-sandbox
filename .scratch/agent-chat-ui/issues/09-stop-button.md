# 09 — Stop button

**What to build:** A control that halts the agent mid-answer.

Pressing it stops the run immediately — the in-flight model request and any running
tool are cancelled, and whatever text had already arrived stays in the transcript. The
conversation remains usable afterwards.

Closing the tab does the same thing server-side. Today a disconnected client leaves
the loop running and billing.

**Blocked by:** 06

**Status:** done

- [x] A stop control is available while the agent is working and not otherwise
- [x] Pressing it ends the answer immediately, keeping the partial text and any tool
      calls already shown
- [x] The next question works normally
- [x] Pressing it during a running tool cancels that tool's work, not just the display
- [x] Closing the tab mid-answer stops the agent server-side
- [x] The web route enforces its own 60-second deadline, and a run that hits it ends
      with a timeout the user can see rather than a stream that never finishes
- [x] The CLI's existing deadline is unchanged and still reports as a timeout

## Comments

Cheap, because the domain was already built for it: the loop, the dispatcher and the
tool handlers all take an abort signal, and only the CLI's deadline currently uses it.

Cancellation is cooperative — a running handler cannot be killed from outside. One
abort controller in the route, fired by any of three triggers: client disconnect, the
route's own deadline, and the stop button (which reaches the server as a disconnect).
That one signal goes into the Agent Loop, which already threads it into every tool and
into the model's in-flight request, so aborting cancels the network call being paid
for rather than only the rendering.

The route needs its own deadline. The existing 60-second one belongs to the CLI's
composition root and is not inherited — the route is a second composition root.

The iteration cap from ticket 01 is a different kind of brake: it ends the run
normally rather than aborting it, so the user should see that the agent gave up rather
than that the stream was cancelled.

Three things that are not automatic. The request handler is *not* cancelled by client
disconnect — the response stream is torn down but the handler body keeps running and
keeps billing, so the disconnect signal must be threaded in explicitly and combined
with our own (the deadline, the iteration cap). The response must be told to consume
its own stream, or the end-of-stream callback never fires on abort and work leaks. And
the protocol's abort chunk renders as nothing on the client, so any visible "stopped"
affordance has to be derived from the request status or sent as our own data part.

---

**Done.** One `AbortController` in `app/api/chat/route.ts`, fired by `abort("client" |
"deadline")`. First trigger wins, and *which* one it was is the only thing that decides what
the user is told — the domain's `AbortedError` deliberately cannot say. `request.signal` is
subscribed explicitly (and checked for `.aborted` first, in case the request was already
abandoned before we got here); the deadline is a `setTimeout` cleared in a `finally`.
`consumeSseStream: consumeStream` on the response. The signal into `runAgent` is now
`controller.signal`, not `request.signal`.

The three endings are told apart:

| | how it is made visible | server log |
| --- | --- | --- |
| stopped | client-side `stopped` state → muted `.run-stopped` note | `[run] stopped — the client disconnected …` |
| timed out | `DeadlineExceededError` through `renderer.end` → red `.run-error` | `[run] timed out — past the 60s deadline …` |
| gave up | `onGaveUp`'s existing error chunk → red `.run-error` | `[run] gave up — still asking for tools after 10 turns` |

"Stopped" cannot come from the server: on a stop the server is writing into a socket that has
already gone. It is remembered in React state instead, because an abort is a *clean* end —
`status` returns to `ready` exactly as after a real answer and no error arrives, so a cut-off
transcript and a finished one are otherwise identical.

**Deviation 1 — the Tavily adapter was rewritten, and it had to be.** The checkbox "cancels
that tool's work, not just the display" failed with `@langchain/tavily`. `TavilySearch` accepts
a `signal` in its runnable config, which reads as if it cancels the search; LangChain only
checks it *between* runnable steps, and `TavilySearchAPIWrapper.rawResults` calls `fetch` with
no signal at all (`node_modules/@langchain/tavily/dist/utils.js:47`). Probed server-side: the
search request ran to completion 1071ms *after* the abort, resolving `ok`, with the loop
sitting waiting on it — the exact bug this ticket exists to catch, and invisible from the UI.
`src/adapters/tavily-search.ts` is now hand-written against `fetch(url, { signal })`, the same
shape `searxng-search.ts` already had. Re-probed: `AbortError` 1–2ms after the signal.
`@langchain/tavily` is now an unused dependency — left in `package.json` deliberately, because
removing it contradicts a sentence in ADR 0002 and that is a decision to make on purpose rather
than as a side effect of this ticket.

**Deviation 2 — two UI judgement calls.** (a) A Tool Call cut off mid-flight was still pulsing
"running…" forever, because the chunk that would close it reaches nobody. `ToolCallView` now
takes `live`; a pending call with the run over reads "cancelled — the run stopped before it
returned". A card claiming work is still happening is the same lie the stop button exists to
prevent. (b) Per the ticket-08 handover, the workflow picker is no longer `disabled={busy}` —
switching mid-run stops the run instead of refusing the click. Verified: server logged
`[run] stopped … after 2128ms` on the switch.

**Verified in Chrome over CDP**, every checkbox, with server-side evidence rather than
inference — including the real unmodified 60s deadline firing (`[run] timed out — past the 60s
deadline after 60005ms`, browser showing `Timed out: the run passed its 60s deadline and was
aborted.`). Closing the tab: `AbortError` on the in-flight search 1ms after the signal, run
ended at 6075ms. Note one negative control: removing `consumeSseStream` did *not* reproduce a
leak here, because `writer.write` only enqueues and never parks. It is kept as the documented
guarantee that end-of-stream runs on abort, but in this code path it is insurance, not the
mechanism — the mechanism is `request.signal`.

**For ticket 10 (request validation), which rewrites the body parsing in this same route:** the
`await request.json()` and the `ChatRequest` cast are still the first two statements of `POST`
and are untouched — validation slots in exactly where the comment says. Three things not to
disturb. The abort wiring must stay *after* validation and *before* `createUIMessageStream`,
and every early return before it (the 400 for an unknown workflow, and whatever 400 validation
adds) must return before `setTimeout` is called, or a rejected request leaves a timer running
for 60s. `request.json()` itself can reject if the client disconnects mid-body, which is
currently an unhandled throw and becomes ticket 10's to decide about. And the plain-text 4xx
shape matters: `DefaultChatTransport` turns a non-ok body into the `error` the page renders, so
a validation failure returned as JSON would reach the user as `[object Object]`.
