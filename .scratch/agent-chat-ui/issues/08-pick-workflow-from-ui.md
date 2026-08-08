# 08 — Pick a workflow from the UI

**What to build:** A selector above the conversation that chooses which Workflow
answers.

It lists the three workflows and shows which tools each one has, so it is clear before
asking anything that `Math` cannot search. Picking a different workflow clears the
conversation and starts fresh against that workflow's model, tools and system prompt.

This is the feature the whole UI is for: asking the same question under two workflows
and watching the agent behave differently.

**Blocked by:** 03, 06

**Status:** ready-for-agent

- [ ] The selector lists `Math`, `Researcher` and `Everything`
- [ ] Each entry shows which tools it has before any question is asked
- [ ] Asking an arithmetic question under `Researcher` shows the agent working without
      the calculate tool, because it was never offered it
- [ ] Asking the same question under `Math` shows the calculate Tool Call
- [ ] Changing the selection clears the transcript and the next question runs under the
      newly selected workflow
- [ ] The workflow the browser asks for is one of the known workflows; anything else is
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
