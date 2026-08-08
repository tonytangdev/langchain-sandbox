/**
 * The Workflows, as data.
 *
 * A Workflow is a named bundle of a system prompt, a Model and a set of Tools, chosen before
 * a conversation begins. This file names a model and names tools; it holds neither. Turning
 * `modelId` into a real `ModelPort` and `toolNames` into real `Tool`s is the composition
 * root's job — see `src/adapters/workflow-runtime.ts`, which both roots go through — so the
 * domain keeps importing no vendor (ADR 0002).
 *
 * There is one list and both composition roots read it. That is the point of the file: a CLI
 * list and a web list would agree on the day they were written and silently disagree
 * afterwards, and the disagreement would show up as "the browser answers differently from my
 * terminal" rather than as an error.
 *
 * Every entry is a one-agent workflow today. The deferred multi-agent work adds an entry —
 * a sub-agent is just a Tool whose handler runs another loop — rather than changing the
 * concept, which is why this is called a workflow and not a profile.
 */

/**
 * The tools a Workflow may name.
 *
 * A closed union rather than `string` so that naming a tool that does not exist is a type
 * error here, and so that the root's resolver can be exhaustive: adding a tool to this union
 * breaks the resolver until it knows how to build it.
 */
export type ToolName = "calculate" | "web_search";

export type Workflow = {
  /** Also the identifier: it is what the CLI is given and what the browser sends. */
  readonly name: string;
  /** What this agent has been told it is. Becomes the loop's `systemPrompt` dependency. */
  readonly systemPrompt: string;
  /** A provider model id, resolved by the composition root. */
  readonly modelId: string;
  /**
   * The only tools offered to the Model on this workflow.
   *
   * Capability is expressed here and nowhere else. `Math` is not *told* it cannot search —
   * the search tool never reaches the model, so refusing to search is not a decision it
   * makes and not one it can be talked out of.
   */
  readonly toolNames: readonly ToolName[];
};

export const WORKFLOWS: readonly Workflow[] = [
  {
    name: "Math",
    // Told what it is and what it has, but nothing about searching. An agent holding only
    // `calculate` and told nothing about itself tends to apologise for being unable to look
    // things up instead of using the tool it does have.
    systemPrompt:
      "You are Math, an agent that answers by calculating. You have a calculator tool. " +
      "Use it for every arithmetic step rather than working the numbers out yourself, even " +
      "when the sum looks easy, and give the answer it returns. If a question cannot be " +
      "answered by arithmetic alone, say so plainly and say what you would need to know.",
    // The one entry on a different model, so the model field is exercised by every run and a
    // bad id cannot hide behind the default.
    modelId: "deepseek/deepseek-v4-flash-0731",
    toolNames: ["calculate"],
  },
  {
    name: "Researcher",
    systemPrompt:
      "You are Researcher, an agent that answers by looking things up. You have a web search " +
      "tool. Use it for anything you are unsure of, anything that may have changed recently, " +
      "and anything after your training cutoff, then answer from what you found and name the " +
      "sources you used.",
    modelId: "moonshotai/kimi-k3",
    toolNames: ["web_search"],
  },
  {
    name: "Everything",
    systemPrompt:
      "You are Everything, an agent with a calculator tool and a web search tool. Choose " +
      "between them: calculate for arithmetic, search for facts you are unsure of or that " +
      "may have changed recently. Some questions need both — look a number up, then compute " +
      "with it. Answer from the tool results rather than from memory.",
    modelId: "moonshotai/kimi-k3",
    toolNames: ["calculate", "web_search"],
  },
];

/**
 * The workflow used when nobody chose one.
 *
 * `Everything` on purpose: it is the only entry that can answer any of the questions the
 * other two can, so an unqualified run behaves the way an unqualified run should.
 */
export const DEFAULT_WORKFLOW: Workflow = WORKFLOWS[2]!;

/**
 * Look a Workflow up by name, case-insensitively.
 *
 * Returns `undefined` rather than throwing because the two callers want different things
 * from a bad name: the CLI prints usage and exits, the web route refuses the request. Both
 * need the same rule — the caller names a workflow, never a definition, so a name that is
 * not in this list is not a workflow.
 */
export function findWorkflow(name: string): Workflow | undefined {
  const wanted = name.trim().toLowerCase();
  return WORKFLOWS.find((workflow) => workflow.name.toLowerCase() === wanted);
}

/** For usage messages and for the UI's selector. */
export function workflowNames(): readonly string[] {
  return WORKFLOWS.map((workflow) => workflow.name);
}
