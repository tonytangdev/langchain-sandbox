# 08 — Pick a workflow from the UI

**What to build:** A selector above the conversation that chooses which Workflow
answers.

It lists the three workflows and shows which tools each one has, so it is clear before
asking anything that `Math` cannot search. Picking a different workflow clears the
conversation and starts fresh against that workflow's model, tools and system prompt.

This is the feature the whole UI is for: asking the same question under two workflows
and watching the agent behave differently.

**Blocked by:** 03, 06

**Status:** done

- [x] The selector lists `Math`, `Researcher` and `Everything`
- [x] Each entry shows which tools it has before any question is asked
- [x] Asking an arithmetic question under `Researcher` shows the agent working without
      the calculate tool, because it was never offered it
- [x] Asking the same question under `Math` shows the calculate Tool Call
- [x] Changing the selection clears the transcript and the next question runs under the
      newly selected workflow
- [x] The workflow the browser asks for is one of the known workflows; anything else is
      refused by the server

## Comments

Clearing on switch is deliberate rather than convenient. A history containing calculate
results while calculate is no longer bound is exactly the state that makes an agent
claim capabilities it does not have — and the resulting bug would not be in our code.
For a demo it also narrates better: the reset is visible.

The selected workflow travels with each request. Whatever mechanism carries it must
re-read the current selection per request rather than capturing it once, or it goes
stale after the first switch.

The browser names a workflow; it never sends a workflow definition. Which models we
pay for is not the client's decision.

---

Built as a radio group of three cards above the transcript (`WorkflowPicker` in
`app/chat.tsx`), each card showing the workflow name and its `toolNames` as chips —
`Math` shows only `calculate`, so its inability to search is readable before anything is
asked. The cards render straight from the imported `WORKFLOWS`, the same list the route
and the CLI read, so the selector cannot offer something the server would refuse. A
`<select>` was rejected because it hides two of three entries and all of the tools.

The name travels as `sendMessage({ text }, { body: { workflow: workflow.name } })`,
read from state at the moment of asking. The staleness trap is real and was avoided
deliberately: `new DefaultChatTransport({ body: { workflow } })` inside `useChat` freezes
the value at first render, because `useChat` keeps the transport it was constructed with.
Verified in Chrome against the real models — within one page mount, question 1 ran under
`Everything` and question 2, after switching, ran under `Researcher`; the route's new
`[workflow] …` server log (mirroring the CLI banner) shows the two different workflows in
order, so the proof is server-side rather than inferred from behaviour.

Switching calls `setMessages([])` and `clearError()`; the picker is disabled while a run
is in flight, since ticket 09 owns cancellation and switching mid-stream would otherwise
need a `stop()` this ticket does not have.

The route resolves the workflow per request. An *absent* name runs `DEFAULT_WORKFLOW`, as
`--workflow` being absent does on the CLI; a *present* name that is not in the list is
`400` with a plain-text body naming the known workflows. The SDK transport turns a non-ok
body into `error.message`, so the refusal renders in the existing `.run-error` line
without any new UI. Confirmed both by `curl` and in the browser by patching `fetch` to
name `Hacker`.
