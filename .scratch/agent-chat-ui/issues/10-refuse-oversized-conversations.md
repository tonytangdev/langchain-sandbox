# 10 — Refuse oversized conversations

**What to build:** The server checks the conversation the browser sends before running
the agent on it, and refuses one that is too large.

The browser owns the transcript and posts the whole thing each turn, so the server is
being handed untrusted input that it then pays a model to read. Past 50 messages or
100k characters, the request is refused with a message saying so.

**Blocked by:** 06

**Status:** done

- [x] A conversation over 50 messages is refused, and the user sees why
- [x] A conversation over 100k characters total is refused, and the user sees why
- [x] A malformed or unparseable conversation is refused rather than half-converted
- [x] Nothing is ever silently dropped or truncated to fit
- [x] Normal conversations are unaffected

## Comments

Refusing rather than truncating is the decision worth keeping. Silent truncation
produces "the agent forgot what I said" behaviour that reads as a model failure and
gets debugged in the wrong place entirely.

The SDK ships a validator for parsing an untrusted request body into typed messages;
the size caps sit on top of it.

100k characters is roughly 25k tokens — generous for a demo, and enough to bound a
single request's input cost to cents rather than dollars. This matters from localhost
too, not only once deployed.

---

Built in `app/api/chat/route.ts`. The whole check is a block of early returns at the top of
`POST`, deliberately *before* the `AbortController` and the deadline `setTimeout` — an early
return past that timer would leave a 60-second timer burning for a request nobody is serving —
and before the workflow lookup, so an oversized body costs us as little as possible.

The SDK's `safeValidateUIMessages` does the shape work (it takes `messages: unknown` and
returns `{ success, data | error }` rather than throwing, so no try/catch around it), and the
two caps sit on top of its output. `workflow` is checked to be a string here; whether it names
a real workflow is still the existing 400 further down. Every refusal goes through one `refuse`
helper: plain text, 400, and a sentence naming the cap and the overage, which the SDK transport
surfaces as `error.message` and the chat page already renders in `.run-error` — no new UI.

Two deviations worth naming. The character count is the text of the messages only, not the
whole JSON body: Tool Calls and their results are in the UI history but `conversationFromUIMessages`
drops every one of them, so counting them would refuse conversations that are in fact cheap to
run. And the SDK's validation error quotes the offending value back in full, so it is truncated
to 400 characters before it reaches the user — a malformed megabyte should not be echoed.

Verified against a running dev server. Refused with 400: 51 messages ("Conversation too long:
51 messages, 1 over the limit of 50…"), 100,001 characters, a body that is not JSON, `messages`
missing, `messages` a string, a message with no `parts`, `role: "wizard"`, and `workflow` as an
object. Accepted with 200: exactly 50 messages and exactly 100,000 characters — the cap is a
cliff, not a trim. In the browser: a multi-turn conversation still works (`2^3^2` → 512, then
"add 8 to that" → 520), and both cap refusals render in red in the existing error line with the
transcript left intact.
