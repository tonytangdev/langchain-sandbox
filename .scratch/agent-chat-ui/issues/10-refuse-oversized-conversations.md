# 10 — Refuse oversized conversations

**What to build:** The server checks the conversation the browser sends before running
the agent on it, and refuses one that is too large.

The browser owns the transcript and posts the whole thing each turn, so the server is
being handed untrusted input that it then pays a model to read. Past 50 messages or
100k characters, the request is refused with a message saying so.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] A conversation over 50 messages is refused, and the user sees why
- [ ] A conversation over 100k characters total is refused, and the user sees why
- [ ] A malformed or unparseable conversation is refused rather than half-converted
- [ ] Nothing is ever silently dropped or truncated to fit
- [ ] Normal conversations are unaffected

## Comments

Refusing rather than truncating is the decision worth keeping. Silent truncation
produces "the agent forgot what I said" behaviour that reads as a model failure and
gets debugged in the wrong place entirely.

The SDK ships a validator for parsing an untrusted request body into typed messages;
the size caps sit on top of it.

100k characters is roughly 25k tokens — generous for a demo, and enough to bound a
single request's input cost to cents rather than dollars. This matters from localhost
too, not only once deployed.
