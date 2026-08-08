# 09 — Stop button

**What to build:** A control that halts the agent mid-answer.

Pressing it stops the run immediately — the in-flight model request and any running
tool are cancelled, and whatever text had already arrived stays in the transcript. The
conversation remains usable afterwards.

Closing the tab does the same thing server-side. Today a disconnected client leaves
the loop running and billing.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] A stop control is available while the agent is working and not otherwise
- [ ] Pressing it ends the answer immediately, keeping the partial text and any tool
      calls already shown
- [ ] The next question works normally
- [ ] Pressing it during a running tool cancels that tool's work, not just the display
- [ ] Closing the tab mid-answer stops the agent server-side
- [ ] The web route enforces its own 60-second deadline, and a run that hits it ends
      with a timeout the user can see rather than a stream that never finishes
- [ ] The CLI's existing deadline is unchanged and still reports as a timeout

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
