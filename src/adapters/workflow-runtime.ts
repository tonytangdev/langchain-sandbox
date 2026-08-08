/**
 * Where a Workflow stops being data and becomes something runnable.
 *
 * `src/domain/workflows.ts` names a model and names tools. This file is the other half: it
 * turns those names into a real `ModelPort` and real `Tool`s, which is the composition root's
 * job and is why the domain imports no vendor (ADR 0002).
 *
 * It sits in `adapters/` rather than in a root because there are two roots — the CLI and the
 * web route — and resolution written twice is resolution that drifts, exactly like the
 * definition list itself. A root's remaining job is small and honest: read the environment,
 * call {@link workflowRuntimeFromEnv}, then {@link resolveWorkflow}, and hand the result
 * straight to `runAgent`.
 */
import { AgentError } from "../domain/errors.js";
import type { ModelPort, SearchPort } from "../domain/ports.js";
import { calculateTool } from "../domain/tools/calculate.js";
import { webSearchTool } from "../domain/tools/web-search.js";
import type { Tool } from "../domain/types.js";
import type { ToolName, Workflow } from "../domain/workflows.js";
import { WORKFLOWS } from "../domain/workflows.js";
import { requireEnv } from "./env.js";
import { openRouterModel } from "./openrouter-model.js";
import { searchFromEnv } from "./search-provider.js";

/**
 * The model ids this build knows how to run.
 *
 * An allowlist rather than "hand whatever string we were given to the provider", because
 * that would resolve anything and fail on the first question with a provider error — the
 * failure this ticket exists to move to startup. Checking it here also needs no network, so
 * the check costs nothing and works with no credential.
 *
 * The cost is that adding a workflow on a new model means editing this list too. That is
 * deliberate: which models we pay for is a decision made here, not in a definition a client
 * could name.
 */
const RUNNABLE_MODEL_IDS: readonly string[] = ["moonshotai/kimi-k3", "deepseek/deepseek-v4-flash-0731"];

/** A Workflow names something this build cannot produce. Names both, because both are needed. */
export class UnrunnableWorkflowError extends AgentError {
  constructor(workflow: string, message: string) {
    super(`Workflow "${workflow}" cannot run: ${message}`);
  }
}

/**
 * Everything resolution needs from the outside world, gathered once per process.
 *
 * The search port is a function rather than a value so that it is only built — and its
 * credential only demanded — by a workflow that actually names `web_search`. Running `Math`
 * needs no search provider at all, and asking for one would be a startup failure with
 * nothing to do with the run.
 */
export type WorkflowRuntime = {
  readonly modelApiKey: string;
  readonly search: () => SearchPort;
};

export function workflowRuntimeFromEnv(): WorkflowRuntime {
  const modelApiKey = requireEnv("OPENROUTER_API_KEY");
  // Memoised: two workflows resolved in one process share one search adapter, and the
  // credential is still only read on the branch that needs it.
  let search: SearchPort | undefined;
  return {
    modelApiKey,
    search: () => (search ??= searchFromEnv()),
  };
}

/** The three dependencies a Workflow decides. The rest of `AgentDependencies` is the run's. */
export type WorkflowDependencies = {
  readonly model: ModelPort;
  readonly tools: readonly Tool[];
  readonly systemPrompt: string;
};

/**
 * Resolve one Workflow into the dependencies `runAgent` takes.
 *
 * @throws {UnrunnableWorkflowError} if the workflow names a model this build cannot run.
 */
export function resolveWorkflow(workflow: Workflow, runtime: WorkflowRuntime): WorkflowDependencies {
  assertModelRunnable(workflow);
  return {
    model: openRouterModel({
      apiKey: runtime.modelApiKey,
      model: workflow.modelId,
      siteName: "langchain-sandbox",
    }),
    // Only the named tools are built, so a capability a workflow does not have is a tool the
    // Model is never shown — not an instruction it could argue with.
    tools: workflow.toolNames.map((name) => resolveTool(name, runtime)),
    systemPrompt: workflow.systemPrompt,
  };
}

/**
 * Check every Workflow before anything runs.
 *
 * Called by each composition root at startup: a bad model id is a mistake in a checked-in
 * definition, so it should surface when the process starts rather than when someone happens
 * to select that workflow and ask it a question.
 *
 * @throws {UnrunnableWorkflowError} naming the first workflow that cannot run, and why.
 */
export function assertWorkflowsRunnable(workflows: readonly Workflow[] = WORKFLOWS): void {
  for (const workflow of workflows) assertModelRunnable(workflow);
}

function assertModelRunnable(workflow: Workflow): void {
  if (RUNNABLE_MODEL_IDS.includes(workflow.modelId)) return;
  throw new UnrunnableWorkflowError(
    workflow.name,
    `it names the model "${workflow.modelId}", which this build cannot run. ` +
      `Known models: ${RUNNABLE_MODEL_IDS.join(", ")}.`,
  );
}

/**
 * The name → Tool table.
 *
 * A switch rather than a record so it is exhaustive: adding a member to `ToolName` fails to
 * compile here until this file knows how to build it.
 */
function resolveTool(name: ToolName, runtime: WorkflowRuntime): Tool {
  switch (name) {
    case "calculate":
      return calculateTool;
    case "web_search":
      return webSearchTool(runtime.search());
  }
}
