---
status: accepted
---

# Zod is domain vocabulary, not a vendor import

ADR 0002 says the domain depends only on ports and imports nothing from any vendor. `zod` is
the single exception, and it is deliberate rather than an oversight: a **Tool** is defined as a
name, a description, a *parameter schema*, and a handler, and the schema needs a language.
Zod is that language here. It is a validation library rather than an I/O framework, so it
brings no transport, no client, and no loop of its own; it is what both LangChain and the
**Provider** already accept, so nothing has to be converted at the boundary; and its type
inference means a handler's argument type is *derived from* its schema rather than restated
beside it, which is what stops a handler disagreeing with the schema the **Model** was shown.

This is recorded as an ADR because the alternative reading — "the domain imports a vendor,
so the hexagon leaks" — is a reasonable thing for a future reader to conclude from the import
list alone, and it was already weighed.

## Considered options

- **A hand-rolled schema type in the domain, converted to Zod in the adapter.** Purest against
  ADR 0002, and genuinely reversible. Rejected because it buys the appearance of independence
  at the cost of writing and maintaining a JSON-Schema-shaped type by hand, plus losing the
  inference that ties a handler to its schema — which is the one property here that prevents a
  real class of bug rather than a stylistic one.
- **JSON Schema objects in the domain, no library at all.** No dependency, and it is what goes
  over the wire anyway. Rejected because the handler's argument type would then be `unknown`
  and every tool would start with a hand-written cast — exactly the disagreement between
  handler and schema this is meant to prevent.

## Consequences

`src/domain/types.ts` imports `zod`, and `Tool.schema` is a `z.ZodObject`. If the Zod
ecosystem is ever left, the blast radius is that one field and the `defineTool` factory beside
it — the **Agent Loop** never touches a schema, it only calls `Tool.run`. Note also that
arguments are parsed against the schema inside `run`, so this import is doing real work at the
trust boundary where untyped JSON arrives from the model, not merely describing types.
