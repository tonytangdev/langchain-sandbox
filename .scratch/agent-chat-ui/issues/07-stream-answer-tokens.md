# 07 — Stream the answer token by token

**What to build:** The agent's answer text appears as it is generated, rather than
arriving complete once the Turn finishes.

This holds across a whole conversation, including one where the agent makes several
Tool Calls before answering — each Turn's text streams, and the tool calls between
them stay in the right place in the transcript.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] A single-turn answer appears progressively rather than all at once
- [ ] An answer that follows one or more Tool Calls also streams
- [ ] In a multi-turn answer, text and tool calls appear in the order they happened
- [ ] Markdown still renders correctly while the text is incomplete
- [ ] The CLI's token output is unaffected

## Comments

The model port already accepts a token callback and the console renderer already uses
it, so the plumbing exists down to the vendor adapter.

The failure mode to watch: each Turn's tokens must be bracketed by explicit start and
end chunks carrying a stable id, and a text delta arriving for an id with no preceding
start is a fatal protocol error rather than a dropped chunk. Turn boundaries reset the
id map, so ids may be reused across turns.

Landing this after 06 is deliberate — when the ordering rule bites, only the token
path is suspect.
