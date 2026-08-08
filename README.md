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
npm run cli -- "What is 2^3^2, and who won the 2024 Ballon d'Or?"
npm run cli -- --workflow Math "What is 2^3^2?"
```

`.env` is gitignored; `.env.example` is committed so you know which keys you need before the
first run. Node's built-in `--env-file` loads it — there is no `dotenv` dependency.

`--workflow` (or `-w`) picks which **Workflow** answers: `Math` has `calculate` and no search,
`Researcher` has search and no arithmetic, `Everything` has both and is the default. Ask the
same question under two of them and the difference is the point — `Math` cannot search because
the tool is never offered to the model, not because it was told not to.

Two questions worth asking first, because they show different shapes:

| Question | What you see |
| --- | --- |
| `"What is 2^3^2?"` | One tool call, two turns. If this returns `512` rather than `64`, the tool ran — JavaScript has no `^` operator to fall back on. |
| `"How many Champions League titles has Real Madrid won? Add 3 to that."` | Search, then `calculate` on the result — two tools chained across **three** turns. |

## In a browser

```bash
npm run dev      # http://localhost:3000
```

The same **Agent Loop**, watched from a web page instead of a terminal. `app/api/chat/route.ts`
is the second composition root and makes the same three calls `src/main.ts` does; the difference
is the observer it attaches. `src/adapters/console-renderer.ts` writes to stdout,
`src/adapters/ui-stream-renderer.ts` writes stream chunks — the loop cannot tell them apart,
which is the argument for ADR 0002 in one file pair.

Each **Tool Call** appears as its own card the moment the model asks for it, showing the
arguments it chose, then the result and how long it took. `--- turn n ---` is the same turn
boundary the CLI prints. The conversation lives in React state and is posted back whole with
every question, which is the entire mechanism behind a follow-up being understood — nothing is
persisted, and a reload starts over.

Because the browser posts the whole transcript, the server is handed untrusted input it then
pays a model to read, so it checks the size first: past 50 messages or 100k characters the
request is refused with a line saying which cap was passed and by how much. It refuses rather
than trimming to fit — a silently dropped message reads as "the agent forgot what I said" and
gets debugged as a model failure.

## Search without a Tavily key (SearXNG)

Set `SEARXNG_URL` and `web_search` goes to your own SearXNG instead of Tavily; leave it unset
and nothing changes. The Tavily key is only read on the Tavily branch, so a SearXNG run needs
no search credential. Same Tool, same output shape — a second adapter behind the same port.

```bash
docker run -d --name searxng -p 8080:8080 \
  -v "$PWD/searxng:/etc/searxng" docker.io/searxng/searxng:latest
```

The first start writes `searxng/settings.yml`. **JSON output is off by default and the adapter
gets a 403 until you turn it on** — add `json` to the formats list, then restart:

```yaml
search:
  formats:
    - html
    - json
```

```bash
docker restart searxng
SEARXNG_URL=http://localhost:8080 npm run cli -- "Who won the 2024 Ballon d'Or?"
```

Expect graceful degradation rather than determinism: after a dozen rapid queries the upstream
engines start blocking, and SearXNG answers `200` with an *empty* results array rather than an
error. The adapter raises that as a search error naming the unresponsive engines, because an
empty list would otherwise reach the model as "the web knows nothing about this". Wait a minute
and it recovers. The snippets are also shorter than Tavily's LLM-extracted content — that is
the trade for having no key.

## What you are looking at

```
[turn 0] 2 tool call(s)          ← one Turn can ask for several tools at once
  → calculate({"expression":"17 + 25"})   ← the moment the model decides to use a tool
  ← calculate returned in 2ms: 42         ← our code ran it; the result goes back as a message
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
