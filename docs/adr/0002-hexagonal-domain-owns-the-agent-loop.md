---
status: accepted
---

# The domain owns the Agent Loop; LangChain is an adapter

We are structuring this repo as a hexagon: the **Agent Loop** is hand-written domain code that
depends only on ports, and every outward-facing concern is an adapter. LangChain is demoted to
a `ModelPort` implementation behind `ChatOpenRouter`, and Tavily to a `SearchPort`
implementation. We deliberately do **not** use LangChain's `createAgent` — the loop is the only
real logic in the project, and putting a third-party framework at the centre of the hexagon
would make the pattern decorative.

## Considered options

- **`createAgent` inside the hexagon** — ports wrap only the model and search. Least code, but
  the domain core imports LangChain, which is the thing hexagonal architecture exists to
  prevent. Rejected as the appearance of hexagonal without the substance.
- **Hexagonal at the edges only** — accept `createAgent` in the middle, apply ports to search
  and rendering, and don't claim the loop is ours. Rejected, but it is the honest fallback if
  hand-rolling the loop proves too costly.

## Consequences

We give up everything LangGraph would have provided for free around `createAgent` —
checkpointing, interrupts, middleware. If any of those are needed later, this is the decision
to revisit, and the fallback above is the shape to revisit it toward. The `langchain` package
itself is no longer a dependency; only `@langchain/core`, `@langchain/openrouter`, and
`@langchain/tavily` are. In exchange the loop becomes directly testable against a scripted
fake `ModelPort` — worth noting because tests are deferred for now (see the reversal risk: a
hexagon whose ports are never faked or swapped is indirection with no consumer).
