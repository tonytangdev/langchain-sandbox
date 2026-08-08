# langchain-sandbox

A one-shot tool-calling **Agent** that shows its work. Ask it a question, watch the answer
stream in, watch each **Tool Call** start and finish, and read the whole message list when it
exits.

The **Agent Loop** here is hand-written code, not a framework call. That is the entire point:
`createAgent` would answer the question and hide the mechanism, and the mechanism is what this
repo exists to make legible.

## Run it

```bash
npm install
cp .env.example .env      # then fill in the two keys
npm start -- "Add 17 and 25, then search the web for who won the 2024 Ballon d'Or."
```

`.env` is gitignored; `.env.example` is committed so you know which keys you need before the
first run. Node's built-in `--env-file` loads it — there is no `dotenv` dependency.

Two questions worth asking first, because they show different shapes:

| Question | What you see |
| --- | --- |
| `"What is 17 + 25?"` | One tool call, two turns. The `add` control: if this returns `42`, the tool wiring is correct. |
| `"How many Champions League titles has Real Madrid won? Add 3 to that."` | Search, then `add` on the result — two tools chained across **three** turns. |

## What you are looking at

```
[turn 0] 2 tool call(s)          ← one Turn can ask for several tools at once
  → add({"a":17,"b":25})         ← the moment the model decides to use a tool
  ← add returned in 2ms: 42      ← our code ran it; the result goes back as a message
[turn 1] no tool calls — the loop ends here
```

That last line is the whole definition of "finished": a **Turn** with no **Tool Calls**. Then
the complete conversation is dumped — your question, the assistant turn carrying tool calls,
the tool result messages, the final answer — unabbreviated, so you can read the shapes rather
than a description of them.

## Layout

Read it in this order:

| | |
| --- | --- |
| `spike/one-shot-agent.ts` | **Start here.** The whole agent in one file, no structure at all. Every mechanic in one screenful. |
| `src/domain/agent-loop.ts` | The same loop, as domain code. ~40 lines, depends only on ports. |
| `src/domain/ports.ts` | `ModelPort` and `SearchPort`. The line between our logic and the vendor's. |
| `src/domain/types.ts` | **Turn**, **Tool Call**, **Message**, **Tool** — the vocabulary of `CONTEXT.md` as types. |
| `src/adapters/` | Where LangChain, OpenRouter and Tavily are allowed to exist. |
| `src/main.ts` | Composition root: builds the adapters, sets the deadline, runs the loop. |

`spike/` is Stage 1 and `src/` is Stage 2 of the same delivery. The spike was throwaway by
intent and is kept anyway, because it is the shortest honest answer to "how does an agent
work" and deleting it would cost that.

`npm run spike -- "…"` runs it. `npm run typecheck` type-checks both.

## Decisions you might want to re-propose

Both contradict the obvious reading of this repo's own name, so they are written down:

- [`docs/adr/0001`](docs/adr/0001-langchain-not-effect.md) — Effect-TS is not used.
- [`docs/adr/0002`](docs/adr/0002-hexagonal-domain-owns-the-agent-loop.md) — the domain owns
  the **Agent Loop**; LangChain is an adapter.

[`CONTEXT.md`](CONTEXT.md) is the glossary. The bolded words above are defined there and mean
exactly one thing each.

## Deliberately not here

Web search is a **Client Tool**, not the provider's server-side one — a provider-side search
would hide the exact step this repo exists to watch. There are no retries: while learning, a
transient failure is more useful visible than smoothed over. There is one whole-run deadline
(60s) rather than per-request timeouts, because per-request timeouts are the vendor's job and
would hide the seam. Conversation history is not persisted; it is one question, one answer.

There are no automated tests yet, on purpose. The seam for them is `runAgent` in
`src/domain/agent-loop.ts`: hand it a scripted `ModelPort` (first call returns a Turn with a
Tool Call, second returns one without) and a stub `SearchPort`, and it runs with no network
and no keys. The moment the loop grows a branch, that seam should get a test.
