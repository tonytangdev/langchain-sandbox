# Spec: one-shot tool-calling agent

Status: ready-for-agent

## Problem Statement

I want to build an agent in TypeScript and I don't understand how agents work. I know the words
— agent, tool, tool call — but not the mechanics: what the model actually returns, who decides
to run a tool, where the results go, or how the thing knows it's finished. Every tutorial I find
either hands me a framework call that does all of it behind one function, or is written against
a LangChain API that has since been renamed. I can't debug a loop I've never seen, and I can't
tell a wiring bug from a bad model decision from a bad search result when all three produce the
same symptom: a disappointing answer.

## Solution

A small command-line program that answers one question and shows its work. I run it with a
question as an argument; I watch the answer stream in token by token, with each **Tool Call**
announced as it starts and finishes; and when it exits it dumps the complete message list — my
question, the assistant **Turn** carrying tool calls, the tool result messages, the final
assistant turn — so I can read the shapes I've only heard described.

Two tools, chosen so failures are attributable. `add` is a control: if the model calls
`add(2, 3)` and gets `5`, my tool plumbing is definitively correct, and anything odd after that
is the model or the search. Web search is the realistic one, and it is a **Client Tool** rather
than a **Server Tool** on purpose — the whole point is to watch the loop, and a provider-side
search would hide exactly the step I'm trying to learn.

The **Agent Loop** is code I write, not a framework call, because it is the thing I'm here to
understand.

## User Stories

1. As a developer learning agents, I want to run the program with a question as a command-line
   argument, so that I can try it without writing any code first.
2. As a developer learning agents, I want the final answer to stream in token by token, so that
   I can see the model working rather than waiting at a blank prompt.
3. As a developer learning agents, I want each **Tool Call** announced when it starts, so that I
   can see the moment the model decides to use a tool.
4. As a developer learning agents, I want each **Tool Call** announced when it finishes, so that
   I can see how long tools take and what they returned.
5. As a developer learning agents, I want the complete message list printed when the program
   exits, so that I can read the actual message shapes instead of a description of them.
6. As a developer learning agents, I want a deterministic `add` tool available, so that I have a
   control case proving my tool wiring works.
7. As a developer learning agents, I want to see `add` receive typed arguments and return a
   value the model then uses, so that I understand the full round trip.
8. As a developer learning agents, I want a real web search tool that my own code executes, so
   that I see the **Tool Call** arrive and the result go back rather than it happening invisibly.
9. As a developer learning agents, I want to watch the model chain two tools in one run, so that
   I understand that a loop can take more than two **Turns**.
10. As a developer learning agents, I want the loop to terminate when a **Turn** contains no
    **Tool Calls**, so that I understand what "finished" means mechanically.
11. As a developer learning agents, I want the loop to handle a **Turn** containing several
    **Tool Calls** at once, so that parallel tool calling doesn't silently drop work.
12. As a developer learning agents, I want the loop written as ordinary code I can read in one
    sitting, so that nothing about it is magic.
13. As a developer learning agents, I want the loop to depend only on ports, so that I can see
    where my logic ends and the vendor's begins.
14. As a developer learning agents, I want LangChain confined to an adapter, so that the vendor
    API churn I was warned about can't reach my loop.
15. As a developer learning agents, I want tool parameter schemas declared once with types
    derived from them, so that a handler can't disagree with its own schema.
16. As a developer learning agents, I want each tool parameter to carry a description, so that I
    see how the model is told what a parameter means.
17. As an operator running the program, I want the run to abort after a deadline, so that a
    stuck model or a hanging search can't bill me indefinitely.
18. As an operator running the program, I want the abort to reach the in-flight HTTP request, so
    that a timeout actually stops work rather than just abandoning a promise.
19. As an operator running the program, I want a clear message when the deadline fires, so that
    I can tell a timeout from a crash.
20. As an operator running the program, I want errors to surface with their stack traces rather
    than being retried, so that I can see what broke while I'm still learning.
21. As an operator running the program, I want credentials read from the environment, so that no
    key is ever written into source.
22. As an operator running the program, I want an example environment file committed, so that I
    know which keys I need before the first run.
23. As an operator running the program, I want the real environment file ignored by git, so that
    I cannot accidentally publish a key.
24. As an operator running the program, I want a clear error when a required key is missing, so
    that I don't debug an authentication failure from the provider instead.
25. As a developer extending this later, I want the search tool reachable through a port, so that
    swapping the search provider doesn't touch the loop.
26. As a developer extending this later, I want the **Model** reachable through a port, so that
    I can drive the loop with a scripted fake and no network.
27. As a developer extending this later, I want token streaming kept out of the port's return
    type, so that the port stays trivial to fake.
28. As a developer extending this later, I want the domain to hold no vendor imports, so that the
    hexagon boundary is visible by inspection rather than by convention.
29. As a developer reading this repo in six months, I want the reasoning behind the architecture
    recorded, so that I don't re-propose an option that was already weighed.
30. As a developer reading this repo in six months, I want the shared vocabulary recorded, so
    that "tool" and "turn" mean one thing each.

## Implementation Decisions

### Architecture

- Hexagonal, per ADR 0002. The **Agent Loop** is hand-written domain code depending only on
  ports. LangChain's `createAgent` is deliberately not used, and the `langchain` package is not
  a dependency.
- Effect-TS is not used, per ADR 0001. Plain `async`/`await` throughout.
- Ports live in the domain; adapters implement them. The domain imports nothing from any vendor.

### Ports

- **`ModelPort`** — one method taking the conversation so far, the available tools, and an
  options object carrying an optional token callback and an optional `AbortSignal`; returning a
  promise of one **Turn**. Value-returning rather than streaming: the domain's question is *what
  did the model decide*, and tokens are a presentation concern that happens to travel over the
  same connection. This keeps a fake to "ignore the callback, return a `Turn`".
- **`SearchPort`** — one method taking a query string and returning a promise of results.

### Domain types

- A **Turn** carries the assistant's text plus zero or more **Tool Calls**. Zero tool calls is
  the loop's termination condition.
- A **Tool** is a name, a description, a Zod schema, and a handler. Zod lives in the domain
  vocabulary deliberately: it is a validation library rather than an I/O framework, it is what
  both LangChain and the provider accept, and its type inference means a handler's argument type
  is derived from its schema rather than restated. Converting this one small type is a contained
  change if the Zod ecosystem is ever left.

### Adapters

- **Model adapter** wraps `ChatOpenRouter` from `@langchain/openrouter`. Note the current API:
  the field is `model` (not `modelName`), `baseURL` is top-level (not nested under
  `configuration`), and the `HTTP-Referer` / `X-Title` headers are optional attribution only.
  It binds the domain tools, consumes the streaming response, invokes the token callback, and
  assembles a domain **Turn**. It is also responsible for turning whatever LangChain throws into
  something the domain understands — LangChain throws untagged errors, so the boundary re-derives
  meaning by hand.
- **Search adapter** wraps `TavilySearch` from `@langchain/tavily`.
- **Model**: `moonshotai/kimi-k3`, verified present and tool-capable on OpenRouter's live
  model list. Note that `parallel_tool_calls` defaults to true on OpenRouter, so a single
  **Turn** may legitimately contain several **Tool Calls**.

### Runtime and dependencies

- Node with `tsx`, ESM, TypeScript `strict: true`.
- `@langchain/core`, `@langchain/openrouter`, `@langchain/tavily`, `zod` v4.
- Environment loaded via Node's built-in `--env-file`, so no `dotenv` dependency. Two variables:
  the OpenRouter key and the Tavily key. An example file is committed; the real one is ignored.

### Behaviour

- One-shot: question in as an argument, answer out, exit. No conversation history persisted.
- A single `AbortController` with a whole-run deadline (~60s), its signal threaded through
  `ModelPort` into the underlying HTTP request. Deliberately not per-request timeouts — those are
  the vendor's job and would hide the seam.
- Streaming is filtered to three concerns only: token deltas, tool-call started, tool-call
  finished. The rest of LangChain's event firehose is noise at this stage. Where LangChain's
  event-stream API takes a version, it is `v3`; tutorials showing `v2` are out of date.
- No retries. Transient failures should be visible, not smoothed over.

### Delivery in two stages

- **Stage 1 — Spike.** A single file, run directly, establishing that the loop works and that
  the message shapes are legible. Throwaway by intent.
- **Stage 2 — Skeleton.** The same behaviour restructured into the hexagon: domain loop, two
  ports, two adapters, a composition root. Chaining search into a fetch-and-extract step becomes
  reasonable here, once the loop is understood.

## Testing Decisions

**Tests are deliberately deferred.** A good test here would exercise external behaviour — given
a model that asks for `add(2,3)`, does the loop dispatch it, feed the result back, and terminate
when the next **Turn** has no **Tool Calls** — and would assert nothing about how the loop is
written internally. None are written yet.

The single seam is recorded so the code is *built to permit* them:

- **The seam is the domain's agent-loop entry point.** It takes the question and its
  dependencies as arguments and returns the final message list. Faked from above with a scripted
  `ModelPort` (first call returns a **Turn** with a **Tool Call**, second returns one without)
  and a stub `SearchPort`. No network, no keys, deterministic.
- This is the highest seam available and the only one proposed. The adapters, argument parsing,
  and rendering sit outside it and are verified by running the program.
- No prior art exists — this is the repo's first seam.

Known risk, recorded in ADR 0002: a hexagon whose ports are never faked or swapped is
indirection with no consumer. `ModelPort` was shaped for fakeability precisely so this decision
stays cheap to reverse. The moment the loop grows a branch, that seam should get a test.

## Out of Scope

- Effect-TS in any form (ADR 0001).
- LangChain's `createAgent`, LangGraph middleware, checkpointing, and interrupts (ADR 0002).
- Multi-turn conversation and any history persistence — one-shot only.
- Provider-side search (OpenRouter's `openrouter:web_search` **Server Tool**), which would hide
  the loop. Noted for completeness: the older `:online` suffix and web-search plugin are
  deprecated in favour of it, and it costs roughly $0.007 per search on top of tokens.
- Retries and backoff on rate limits or upstream errors.
- LangSmith or any hosted tracing dashboard; observability is stdout for now.
- Automated tests (see Testing Decisions).
- Structured output, response schemas, and forcing a particular tool.

## Further Notes

The two architectural reversals behind this spec are recorded as ADRs rather than left implicit,
because both contradict the obvious reading of the repo's own name: `docs/adr/0001` (Effect-TS is
not used) and `docs/adr/0002` (the domain owns the **Agent Loop**). Both list their rejected
alternatives so they aren't re-proposed without context.

`CONTEXT.md` is the glossary; the capitalised terms above are defined there.

One vendor trap worth knowing while implementing: do not combine a `strict: true` tool with a
provider server tool — `@langchain/core`'s tool converter throws a `TypeError` on that
combination. It doesn't arise given the scope above, but it is a cheap footgun to step on later.

## Comments

**Implemented.** Both stages delivered: `spike/one-shot-agent.ts` (Stage 1) and the hexagon
under `src/` (Stage 2). `README.md` added as the reading order.

Deviations from the spec as written, all deliberate:

- **Model is `moonshotai/kimi-k3`**, not `anthropic/claude-opus-5` — changed on request during
  implementation, and verified present and tool-capable on OpenRouter's live model list. The
  Implementation Decisions section above was updated to match.
- **Streaming uses `.stream()`, not `streamEvents`.** The spec's note about the event-stream
  API taking `v3` still holds if that API is ever used, but consuming the chunk stream gives
  the two things wanted here — token deltas, and an accumulated message carrying the Tool
  Calls — without filtering an event firehose down to them.
- **Tool-call started/finished are emitted by the loop, not by the stream.** They have to be:
  these are Client Tools, so LangChain never sees them run. `AgentObserver` in
  `agent-loop.ts` carries all three concerns, and `ModelPort` carries only the token callback
  as specified.
- **`exactOptionalPropertyTypes` is off.** `@langchain/tavily`'s tool input types don't
  survive it, and satisfying it elsewhere pushed conditional-spread noise into the loop — the
  one file the spec asks to be readable in one sitting. `strict` and
  `noUncheckedIndexedAccess` are on.
- **`OpenRouterModelConfig` accepts an optional `baseURL`.** One line, and it is what let the
  model adapter be pointed at a stub server to verify the vendor wiring.

Still no automated tests, as specified. The seam is `runAgent` and it was exercised through a
scripted `ModelPort` during implementation; that harness was thrown away rather than
committed. It is the obvious thing to reinstate when the loop grows its first branch.
