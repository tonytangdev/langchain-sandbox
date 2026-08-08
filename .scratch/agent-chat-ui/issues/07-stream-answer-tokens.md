# 07 — Stream the answer token by token

**What to build:** The agent's answer text appears as it is generated, rather than
arriving complete once the Turn finishes.

This holds across a whole conversation, including one where the agent makes several
Tool Calls before answering — each Turn's text streams, and the tool calls between
them stay in the right place in the transcript.

**Blocked by:** 06

**Status:** done

- [x] A single-turn answer appears progressively rather than all at once
- [x] An answer that follows one or more Tool Calls also streams
- [x] In a multi-turn answer, text and tool calls appear in the order they happened
- [x] Markdown still renders correctly while the text is incomplete
- [x] The CLI's token output is unaffected

## Comments

The model port already accepts a token callback and the console renderer already uses
it, so the plumbing exists down to the vendor adapter.

The failure mode to watch: each Turn's tokens must be bracketed by explicit start and
end chunks carrying a stable id, and a text delta arriving for an id with no preceding
start is a fatal protocol error rather than a dropped chunk. Turn boundaries reset the
id map, so ids may be reused across turns.

Landing this after 06 is deliberate — when the ordering rule bites, only the token
path is suspect.

---

Built entirely inside `src/adapters/ui-stream-renderer.ts` — no other file changed. The
domain, the Agent Loop, `app/api/chat/route.ts` and `app/chat.tsx` are untouched, which is
the ADR 0002 claim holding up: a second watcher learned to stream and the loop did not
notice.

The ordering trap was real. `onToken` fires *during* `model.respond` and `onTurn` only
*after* it, so `start-step` could no longer be written from `onTurn` — the first token would
have overtaken its own turn boundary. Solved with two pieces of explicit state: a `stepOpen`
flag behind an idempotent `openStep()` that whichever hook fires first calls, and a
`turnIndex` counter the renderer keeps itself (the loop's index is not available when the
first token needs an id) which resynchronises from `onTurn`, so the two cannot drift.

`textId` is opened lazily on the first token and closed in `onTurn`, so a turn that is pure
Tool Calls still gets its `start-step` and never emits a dangling `text-start`/`text-end`.
`onTurn` keeps a fallback that writes `turn.text` whole when no token ever arrived, so a
ModelPort that does not stream — a scripted one in a test — still shows its text.

`end()` now closes an open text part before writing `finish`, which is what ticket 09 needs:
a run aborted mid-token would otherwise leave the client's part in the "streaming" state
forever.

Verified in Chrome over CDP, sampling the DOM with a MutationObserver (a `setInterval` is
clamped to 1/second in an unfocused tab and understates the arrival rate). A ~200-word
answer after a `web_search` grew 0 → 1391 characters across 33 distinct DOM samples over
6.3s, with Streamdown's rendered node count climbing 1 → 15 and no sample ever containing a
raw `**`. Raw chunk order on a three-turn run was `start`, `start-step`,
`tool-input-available`/`tool-output-available` (web_search), `start-step`,
`tool-input-available`/`tool-output-available` (calculate), `start-step`, `text-start
turn-2`, 35 × `text-delta`, `text-end`, `finish`. CLI output re-checked and unchanged.
