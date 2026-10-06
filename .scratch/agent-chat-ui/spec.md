# Agent Chat UI

Status: needs-triage

A web chat interface for the agent, with a selector that chooses which workflow
answers — where a workflow bundles a system prompt, a model, and a set of tools.

## Problem

The agent is only reachable through `npm run cli "<question>"`. That is fine for
proving the loop works and useless for everything else: you cannot ask a follow-up,
you cannot see a tool call as it happens, and you cannot change the agent's
capabilities without editing `src/main.ts` and re-running.

Three things follow from that, and this spec covers all three:

1. A chat interface, so a conversation continues instead of restarting.
2. Streaming, so tool calls are visible as they happen rather than after the fact.
3. A selector, so the agent's model and toolset change from the UI.

The deeper motivation for (3): flipping a capability off and watching the agent's
behaviour change is the fastest way to understand tool-calling. That is what this
repo is for.

## User stories

### Chat

1. As a user, I open the app and see an empty conversation with a text box.
2. As a user, I type a question and see the agent's answer stream in token by token.
3. As a user, I ask a follow-up and the agent remembers what we already said.
4. As a user, I reload the page and get a fresh empty conversation.
5. As a user, I press Stop mid-answer and the agent stops immediately, keeping
   whatever it had already produced.

### Visible tool calls

6. As a user, I see each tool call appear as it is requested, showing the tool name
   and the arguments the model chose.
7. As a user, I see each tool result appear when it returns.
8. As a user, I can tell the difference between "the model is thinking", "a tool is
   running", and "the answer is being written".
9. As a user, when a tool fails I see the error in place of the result, and the
   agent carries on rather than the conversation dying.

### Workflow selection

10. As a user, I pick a workflow from a dropdown before I start typing.
11. As a user, picking `Math` means the agent can do arithmetic and cannot search.
12. As a user, picking `Researcher` means the agent can search and cannot do arithmetic.
13. As a user, picking `Everything` means the agent chooses between both.
14. As a user, changing the workflow clears the conversation and starts fresh.
15. As a user, I can see which tools the selected workflow has before I ask anything.

### Arithmetic

16. As a user, I ask "what is 2^3^2" and get 512 — right-associative, not 64.
17. As a user, I ask something that divides by zero and get a clear error, not `Infinity`.
18. As a user, I ask for arithmetic the model cannot do in its head and the tool does it.

### Search without a vendor key

19. As a developer, I run the whole thing against a local SearXNG container with no
    API key configured.
20. As a developer, I set no `SEARXNG_URL` and it falls back to Tavily.

### The CLI keeps working

21. As a developer, `npm run cli "<question>"` still works exactly as before.
22. As a developer, when the UI misbehaves I can run the same question through the
    CLI to find out whether the loop or the web adapter is at fault.

## Decisions

### Scope and staging

- **Single agent first.** The UI, streaming, workflow selection, `calculate` and
  SearXNG all land against a one-agent workflow. Multi-agent is a separate effort
  (see Deferred).
- The streaming path is unproven and its failure modes are silent. It gets debugged
  with one agent, not with nested agents emitting interleaved parts.

### Stack

- **Next.js App Router at the repo root.** `app/` beside `src/`; the route handler
  imports `../src/domain/agent-loop`. Not a monorepo — one app and one library does
  not justify workspaces.
- **Vercel AI SDK UI** — `ai@7.0.58` + `@ai-sdk/react@4.0.61`. Both pinned exactly:
  `@ai-sdk/react` declares `ai` as an exact `dependencies` pin, not a peer dep, so
  they move together or you get two copies of `ai` in the tree.
- **A major-version bump of `ai` is a task with testing, not `npm update`.** The UI
  Message Stream Protocol has no formal spec and no conformance suite; we are coding
  against observed behaviour, and majors have shipped fast (v5 → v6 → v7 in about a year).
- **Node 22+.** Required by `ai` v7, which is also ESM-only. Pin in `engines`.
- **React 19.**
- **Two tsconfigs.** `tsconfig.json` for Next (it rewrites this file on first run),
  `tsconfig.node.json` for the domain and CLI, keeping `NodeNext` and
  `verbatimModuleSyntax`. `npm run typecheck` runs both.
- **The CLI survives.** `npm start` → `npm run cli`; `npm run dev` is Next.

### UI components

- **No Tailwind, no shadcn, no AI Elements.** AI Elements is a shadcn registry that
  vendors ~6 component files plus ~15 Radix-backed primitives and ~20 npm deps into
  the repo. That is a large permanent surface area for a repo whose identity is being
  small enough to read.
- **Hand-rolled CSS plus exactly two direct dependencies**: `streamdown` for
  streaming-safe markdown, `use-stick-to-bottom` for pin-to-bottom autoscroll that
  does not fight a user scrolling up. These are the two genuinely hard things.
- The tool-call card is written by hand — `message.parts` is a plain discriminated
  union, so it is a `switch`.

### Streaming

- **Tokens and steps.** Step events (turn boundaries, tool call, tool result) are the
  part that demonstrates a tool-calling agent; token streaming is the part that feels
  right. Land steps first, then tokens — so that when the ordering rule bites, only
  the token path is suspect.
- **A new adapter, not a new port.** `AgentObserver` already has `onToken`,
  `onTurn`, `onToolCallStart` and `onToolCallEnd`. The SSE renderer is a second
  implementation of the same interface that `console-renderer.ts` implements. The
  loop does not change.
- **`writer.write()` is synchronous and fire-and-forget**, so it is called directly
  from observer callbacks with no ordering hazard.
- **`execute` must return a promise resolved from the terminal callback.** The stream
  closes when that promise settles. It must resolve on every path — success, error,
  and abort — or the HTTP response never terminates.
- **Emit `{type:'start'}` explicitly.** `createUIMessageStream` does not add it, and
  without it no assistant message is created client-side. A stream of pure
  `text-delta`s renders nothing, silently.
- **Use `dynamic: true` on tool chunks** → `dynamic-tool` parts. Statically-typed
  `tool-*` parts need tool names known at compile time to type `UIMessage`; a
  workflow-selected toolset is chosen at runtime.
- Field names that are easy to get wrong: text deltas use `delta`; tool input deltas
  use `inputTextDelta`. Tool lifecycle is `tool-input-start` → `tool-input-available`
  (`input`) → `tool-output-available` (`output`) / `tool-output-error` (`errorText`).
- One `text-start` per turn with a fresh id, bracketing that turn's tokens;
  `finish-step` resets the id map.

### Conversation

- **`runAgent(messages: Message[], deps)`** replaces `runAgent(question: string, deps)`.
  The loop already builds and returns a `Message[]`; the caller now seeds it.
- **Nothing persists.** Reload is a fresh conversation. No localStorage — persisted
  `UIMessage[]` is exactly what breaks across an `ai` major. No database.
- **The client owns the transcript** and POSTs it each turn.
- **Validate it.** `validateUIMessages({ messages })` parses the untrusted body into
  typed `UIMessage[]`. Then enforce **50 messages** and **100k characters** total.
  Reject on breach with a clear error — never truncate silently, which produces
  "the agent forgot what I said" bugs that look like model failures.
- **`UIMessage` → domain `Message` is a hand-written adapter.** `ModelMessage` and
  `convertToModelMessages` are not used; the contract with `useChat` is `UIMessage`
  in and `UIMessageChunk` out, so the domain type is untouched.

### Workflows

- A workflow is `{ name, systemPrompt, modelId, toolNames }`.
- **Definitions live in the domain as data** — `src/domain/workflows.ts` holds names
  and ids only. The composition roots (the CLI and the route handler) resolve
  `modelId` → `ModelPort` and `toolNames` → `Tool`. The domain never imports a vendor
  (ADR 0002). Two composition roots sharing one definition list is the point: otherwise
  they drift.
- **`Message` gains a `"system"` role** and the loop seeds it from the workflow. An
  agent holding only `calculate` and told nothing about itself tends to apologise for
  being unable to search instead of using the tool it has.
- **Three entries day one:**
  | Name | Model | Tools |
  |---|---|---|
  | `Math` | `deepseek/deepseek-v4-flash-0731` | `calculate` |
  | `Researcher` | `moonshotai/kimi-k3` | `web_search` |
  | `Everything` | `moonshotai/kimi-k3` | `calculate`, `web_search` |
- A `modelId` that does not resolve must fail loudly at startup, naming the workflow
  and the model, rather than on the first question.
- **Called "workflow", not "profile", from the start.** Every entry is a one-agent
  workflow today; adding a multi-agent entry later is a new array element rather than
  a UI change.
- **Changing the selection clears the conversation.** History containing `calculate`
  results while `calculate` is no longer bound is exactly the state that makes an
  agent hallucinate capabilities.
- Passed per request via `DefaultChatTransport({ body: () => ({ workflowId }) })` —
  the **function form**, since an object literal captures the value at transport
  construction and goes stale.

### `calculate`

- **Replaces `add`, which is deleted.** `add` existed as a control to prove wiring;
  `calculate` proves the same thing better, and keeping both gives the model two
  overlapping arithmetic tools to choose between.
- **A hand-written recursive-descent parser, ~57 lines, zero dependencies.** Grammar:
  `+ - * / ^ ( )` and unary minus. Sticky-regex tokenizer, four mutually-recursive
  functions. `power := atom ('^' unary)?` and `unary := '-' unary | power` gives both
  `2^3^2 === 512` and `-2^2 === -4`.
- **Why not a library.** mathjs's own docs say its sandbox is not safe, and three
  high-severity sandbox-escape-to-RCE advisories landed in April 2026 alone, including
  CVE-2026-41139 (CVSS 8.8, "no workarounds"); `limitedEvaluate` is a denylist that did
  not block it, and mathjs's own mitigation advice is a worker with a timeout. `expr-eval`
  is unmaintained with two unfixed CVEs — and CVE-2025-12735 hit LangChain JS precisely
  because its `Calculator` tool was built on it. `new Function` + a regex allowlist fails
  on correctness before security: `^` is XOR in JavaScript, so `2^3` returns `1`.
- The security argument is structural, not defensive: with no identifiers, no member
  access and no function calls in the grammar, there is nothing to escape into.
- **Wrapper rules:** guard empty input before evaluating (`""` must not become the
  string `"undefined"`); return errors as strings and never throw, so the model can
  retry rather than the loop aborting; `!Number.isFinite(r)` catches NaN, ±Infinity and
  overflow in one check; `Number(r.toPrecision(12))` renders `0.1+0.2` as `0.3`.
  Never `toFixed(2)` — it corrupts large and small magnitudes.
- Note in the tool description that integers above 2^53 are silently imprecise.

### Search

- **A second `SearchPort` adapter**, `src/adapters/searxng-search.ts`, beside Tavily.
  `SEARXNG_URL` set → SearXNG, otherwise Tavily. No change to `ports.ts`,
  `web-search.ts`, or the loop.
- SearXNG returns `title`, `url`, `content` — the same three fields `SearchResult`
  already has, so `JSON.stringify(results, null, 2)` keeps working unchanged.
- **`format=json` returns 403 until enabled** in `settings.yml`:
  `search: { formats: [html, json] }`.
- **A degraded instance returns 200 with an empty `results` array**, not an error.
  Throw `SearchError` on empty and surface `unresponsive_engines` in the message —
  matching `tavily-search.ts`'s existing instinct that errors here should be visible.
- Expect graceful degradation, not determinism: after ~12 rapid queries upstream
  engines begin blocking and results collapse to a single engine.
- Accepted loss: Tavily's LLM-tuned extracted content becomes ~158-character SERP
  snippets.
- **Do not build** DuckDuckGo (challenge page on the first anonymous request,
  unmaintained client, against ToS), Google CSE (closed to new signups, shuts down
  1 Jan 2027), or Bing (retired 11 Aug 2025). Brave is viable but paid since
  February 2026, so it adds a key without removing one.
- Note: `@langchain/community` is deprecated and archived read-only as of 27 May 2026,
  so its `SearxngSearch` and DuckDuckGo tools are abandoned code. Hand-write the adapter.

### Cancellation

- The route handler owns an `AbortController` and threads `signal` into `runAgent`
  exactly as `main.ts` does. The 60s deadline stays as a second trigger on the same
  controller.
- **`execute` is not cancelled by client disconnect.** The output stream is cancelled;
  the body keeps running and keeps billing. Merge the signals explicitly:
  `AbortSignal.any([req.signal, mine.signal])`.
- **`consumeSseStream: consumeStream` is mandatory** on `createUIMessageStreamResponse`,
  or `onEnd` never fires on abort.
- `useChat` returns `stop()` and `status: 'submitted' | 'streaming' | 'ready' | 'error'`.
- The `abort` chunk renders as nothing client-side. A visible "(stopped)" affordance
  must be derived from `status` or emitted as a `data-*` part.
- `onAbort` does not exist on `createUIMessageStream` — only on `streamText`. Abort
  awareness comes from `onEnd({ isAborted })`.

### Loop safety

- **Add a max-iterations guard of 10** to `runAgent`. The loop is currently
  `for (let index = 0; ; index++)` with no upper bound; a model that loops on tool
  calls burns credits until the deadline fires. This matters from localhost, not just
  in production.

### Testing

- **No tests**, consistent with the existing spec's deferral. The parser will instead
  be exercised through the CLI before the UI is wired, so a wrong answer surfaces
  while the surface area is one file.
- Recorded risk: the parser, the `UIMessage` → `Message` adapter, and the observer →
  stream adapter are all places where being wrong is silent. The first two are pure
  functions and would be cheap to test later if that becomes annoying.

## Glossary additions

`GLOSSARY.md` needs, once this lands:

- **Workflow** — a named bundle of a system prompt, a model, and a set of tools,
  selected before a conversation begins.
- **System Message** — the instructions given to a model before the conversation,
  not part of the conversation itself.
- **Agent Observer** — already missing, flagged by the previous spec.

## Out of scope

- Authentication and deployment. Local only for now. When it deploys, the gate is a
  shared password enforced in Next middleware in front of `/api/chat` — the route
  that costs money, not the page.
- Conversation persistence of any kind.
- Human-in-the-loop tool approval. The AI SDK supports it
  (`tool-approval-request` / `approval-requested`), but it requires the loop to become
  resumable.
- Rate limiting, per-IP or otherwise.
- Attachments, file upload, images.
- Editing or regenerating messages.
- Multiple concurrent conversations or threads.

## Deferred

- **Multi-agent workflows, as agent-as-tool.** A sub-agent is a `Tool` whose handler
  calls `runAgent` with different deps — different model, different tools, its own
  system prompt. Nothing structural changes: no orchestrator, no graph runtime, and
  the existing loop runs unmodified at both levels. The workflow dropdown already
  accommodates it as a new entry.
  - The open design question is how nested tool calls surface in the stream: as
    nested UI parts, or deliberately hidden behind the sub-agent's summary. This is
    why it does not land alongside the first streaming implementation.
  - **This needs an ADR**, and it touches ADR 0002's reasoning: multi-agent
    orchestration is what LangGraph does, and ADR 0002 rejected LangGraph. The
    argument for hand-writing an orchestrator is similar in shape to the argument for
    hand-writing the loop, but it is a separate decision and should be made after
    building agent-as-tool, not before.
  - Supervisor/handoff routing, where control genuinely transfers between agents, is
    the version that would most seriously reopen ADR 0002. Not now.
- A `FetchPort` — SearXNG finds pages with thin snippets; a fetcher would deepen the
  top few results. Doubles latency; snippets are usually enough for a one-shot agent.
- A Wikipedia `list=search` adapter (no key, clean JSON) as a deterministic offline-ish
  `SearchPort` for development.
- Token streaming, if steps land first and tokens prove awkward.

## Comments

Design settled through a grilling session. Every decision above was put to the user
and answered; nothing here is assumed.

Two decisions were made against the recommendation given at the time, and are recorded
as the user's call: adopting the Vercel AI SDK over assistant-ui (accepting the
unversioned-protocol maintenance tax, mitigated by exact pinning), and shipping no
tests (mitigated by exercising the parser through the CLI first).

One recommendation was reversed mid-session: AI Elements was recommended, then
withdrawn once its actual install chain — Tailwind v4, shadcn init, 24 Radix
primitives, ~20 deps — was priced against a repo with no frontend at all.
