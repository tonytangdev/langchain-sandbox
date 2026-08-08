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

**Status:** done

- [x] Three workflows exist: `Math`, `Researcher`, `Everything`
- [x] The CLI takes a workflow name and runs that workflow's model, tools and system
      prompt
- [x] Asking `Math` to search the web is refused by capability, not by instruction —
      the search tool is not offered to the model at all
- [x] `Everything` picks the right tool for an arithmetic question and for a
      current-events question
- [x] A workflow naming a model that does not resolve fails at startup with a message
      naming the workflow and the model, not on the first question
- [x] Omitting the workflow name keeps the CLI working against a sensible default
- [x] The domain still imports no vendor package

## Comments

Called "workflow" rather than "profile" deliberately. Every entry is a one-agent
workflow today; the deferred multi-agent work adds an entry rather than changing the
concept or the UI.

`Math` runs `deepseek/deepseek-v4-flash-0731` and the other two run
`moonshotai/kimi-k3`, so at least one entry exercises the model field and a bad id
surfaces immediately.

One definition list shared by two composition roots is the point. Defining workflows
in each root instead is where they silently drift apart.

Definitions live in `src/domain/workflows.ts` as `{ name, systemPrompt, modelId, toolNames }`
data — no vendor import — with `WORKFLOWS`, `DEFAULT_WORKFLOW` (`Everything`), `findWorkflow`
(case-insensitive) and `workflowNames`. Resolution is the composition roots' job but is
written once, in `src/adapters/workflow-runtime.ts`: `workflowRuntimeFromEnv()` gathers the
credential and a lazy `SearchPort`, `resolveWorkflow(workflow, runtime)` returns
`{ model, tools, systemPrompt }` for `runAgent`, and `assertWorkflowsRunnable()` checks every
definition at startup. The CLI calls exactly those three; ticket 06's route calls the same
three, so the two roots cannot drift.

Two deviations worth naming. Model resolution checks the id against a short allowlist of the
models this build runs, because handing any string to the provider would resolve everything
and fail on the first question instead of at startup — the failure this ticket is about. And
the SearXNG/Tavily choice moved out of `main.ts` into `adapters/search-provider.ts` for the
same shared-by-two-roots reason; it is built lazily, so `Math` now runs with no search
credential set at all.

CLI syntax is `npm run cli -- [--workflow <name>] "question"` (`-w`, `--workflow=<name>`);
omitting it runs `Everything`. A flag rather than a positional argument because a bare `Math`
is both a plausible workflow name and a plausible start to a question.

Verified against live providers: `Math` chose `calculate` for `(17 + 25) * 2^3` and refused a
web-search question by capability ("I only have a calculator tool") with no search adapter
ever constructed; `Everything` chose `calculate` for arithmetic and `web_search` for a
current-events question; omitting the name ran `Everything`; and temporarily corrupting
`Math`'s model id failed at startup with `Workflow "Math" cannot run: it names the model
"..." ...` before any question was sent, even when a different workflow was selected.

