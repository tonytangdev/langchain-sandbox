---
status: accepted
---

# Effect-TS is not used; LangChain is the provider client

This repo was created to explore building an agent with LangChain inside Effect-TS. There is
no integration between the two — nothing official, nothing maintained on npm — and the two
are architecturally redundant rather than complementary: both want to own the **Agent Loop**,
**Tool** definitions, and observability, so combining them means picking a winner three times
and declaring every tool schema twice (Zod for LangChain, Effect Schema for Effect). We are
therefore using plain LangChain with async/await, and Effect is out of scope for this repo.
LangChain's role is narrow — reaching the **Provider** and normalising **Tool Call** shapes.
Who owns the **Agent Loop** is decided separately in ADR 0002.

## Considered options

- **LangChain's loop inside an Effect shell** — one `Effect.tryPromise` around the agent call.
  Cheap to adopt and cancellation composes genuinely well (`Effect.tryPromise` hands its
  callback an `AbortSignal` that fires on fiber interruption, and LangChain's config accepts
  `signal`). Rejected because it pays for two frameworks that each solve the problem alone,
  and gives up typed errors inside the loop anyway — LangChain throws untagged `Error`s, so
  the error channel has to be re-derived by hand at every call site.
- **Effect owns everything** — `effect/unstable/ai` plus `@effect/ai-openrouter`, no LangChain.
  Genuinely attractive: one schema language, typed errors and resource safety throughout, and
  a loop-shaped API (`LanguageModel.generateText` is a single **Turn**, so you build the loop
  on top) that would have suited ADR 0002's decision well. Rejected because it is experimental
  — v4 files it under `unstable/` — and would put a near-daily-publishing beta on the critical
  path of a first project.

## Consequences

Cancellation and timeouts are hand-rolled with `AbortController` rather than inherited from a
runtime, and errors are untyped at the adapter boundary — each adapter is responsible for
turning whatever LangChain throws into something the hexagon understands. If Effect is ever
reconsidered, the seam to look at is the `AbortSignal`: it is the one parameter that carries
over unchanged.
