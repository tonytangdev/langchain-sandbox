# 03 — Workflows as data, selectable from the CLI

**What to build:** A **Workflow** — a named bundle of a system prompt, a model, and a
set of tools — chosen when the agent runs.

Three ship: `Math` can do arithmetic and cannot search, `Researcher` can search and
cannot do arithmetic, `Everything` chooses between both. Running the CLI with a
workflow name changes what the agent can do and what it has been told it is, which is
the whole point — flipping a capability off and watching the behaviour change.

Workflows are defined once, as data, and used by both the CLI and (later) the web
route. Definitions name a model and name tools; resolving those names to a real Model
and real Tools is the composition root's job, so the domain keeps importing no vendor.

**Blocked by:** 01, 02

**Status:** ready-for-agent

- [ ] Three workflows exist: `Math`, `Researcher`, `Everything`
- [ ] The CLI takes a workflow name and runs that workflow's model, tools and system
      prompt
- [ ] Asking `Math` to search the web is refused by capability, not by instruction —
      the search tool is not offered to the model at all
- [ ] `Everything` picks the right tool for an arithmetic question and for a
      current-events question
- [ ] A workflow naming a model that does not resolve fails at startup with a message
      naming the workflow and the model, not on the first question
- [ ] Omitting the workflow name keeps the CLI working against a sensible default
- [ ] The domain still imports no vendor package

## Comments

Called "workflow" rather than "profile" deliberately. Every entry is a one-agent
workflow today; the deferred multi-agent work adds an entry rather than changing the
concept or the UI.

`Math` runs `deepseek/deepseek-v4-flash-0731` and the other two run
`moonshotai/kimi-k3`, so at least one entry exercises the model field and a bad id
surfaces immediately.

One definition list shared by two composition roots is the point. Defining workflows
in each root instead is where they silently drift apart.
