/**
 * The vocabulary of `CONTEXT.md`, as types.
 *
 * Nothing in `src/domain/` imports from a vendor. `zod` is the one exception, and a
 * deliberate one — see `docs/adr/0003-zod-is-domain-vocabulary.md`, which records why and
 * what was weighed against it.
 */
import type { z } from "zod";

/** The Model's request to run one Tool with concrete arguments. Not a result. */
export type ToolCall = {
  /** Provider-assigned id. The matching result message quotes it back. */
  readonly id: string;
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
};

/**
 * One model response: answer text, zero or more Tool Calls, or both.
 *
 * Zero tool calls is the Agent Loop's termination condition — that is the whole of what
 * "the agent finished" means mechanically.
 */
export type Turn = {
  readonly text: string;
  readonly toolCalls: readonly ToolCall[];
};

/** One entry in the conversation sent to the Model. */
export type Message =
  /**
   * Instructions the Model is given before anyone speaks. Not part of the conversation the
   * user is having — it is what the agent has been told it is, which is why the Agent Loop
   * takes it as a dependency and puts it ahead of the messages it was handed.
   */
  | { readonly role: "system"; readonly content: string }
  | { readonly role: "user"; readonly content: string }
  | { readonly role: "assistant"; readonly content: string; readonly toolCalls: readonly ToolCall[] }
  | {
      readonly role: "tool";
      readonly toolCallId: string;
      readonly name: string;
      readonly content: string;
    };

/**
 * A Tool as the Agent Loop sees it: something with a name and a description to show the
 * model, a schema to show the model, and one way to run it.
 *
 * The schema's static type is deliberately erased here so a heterogeneous list of tools has
 * a single type. Build these with {@link defineTool}, which keeps the link between schema
 * and handler while it still exists.
 */
export type Tool = {
  readonly name: string;
  readonly description: string;
  readonly schema: z.ZodObject;
  /** Validates `rawArgs` against `schema`, runs the handler, and stringifies the result. */
  readonly run: (rawArgs: unknown, signal?: AbortSignal) => Promise<string>;
};

/**
 * Declares a tool's parameters once and derives the handler's argument type from them, so a
 * handler cannot disagree with its own schema.
 *
 * Arguments arrive from the model as untyped JSON, so they are parsed against the schema on
 * the way in — a model that invents a parameter fails loudly here rather than surfacing as a
 * strange answer three turns later.
 */
export function defineTool<S extends z.ZodObject>(spec: {
  name: string;
  description: string;
  schema: S;
  handler: (args: z.infer<S>, signal?: AbortSignal) => string | Promise<string>;
}): Tool {
  return {
    name: spec.name,
    description: spec.description,
    schema: spec.schema,
    run: async (rawArgs, signal) => spec.handler(spec.schema.parse(rawArgs), signal),
  };
}
