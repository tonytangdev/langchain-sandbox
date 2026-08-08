/**
 * The Agent Loop — the only real logic in this project, and the reason the hexagon exists
 * (ADR 0002). It is ordinary code, depends only on ports, and is meant to be read in one
 * sitting.
 */
import { UnknownToolError } from "./errors.js";
import type { ModelPort } from "./ports.js";
import type { Message, Tool, ToolCall, Turn } from "./types.js";

/**
 * Everything the loop does that is worth watching. Purely an observer — nothing it returns
 * changes what the loop decides — which is why the loop can be run with none of it attached.
 */
export type AgentObserver = {
  /** One token of the assistant's answer text, as it is produced. */
  readonly onToken?: (token: string) => void;
  /** A Turn has arrived in full; `index` counts from 0. */
  readonly onTurn?: (turn: Turn, index: number) => void;
  /** We are about to run a tool the model asked for. */
  readonly onToolCallStart?: (call: ToolCall) => void;
  /** That tool returned. `durationMs` is wall-clock, which is most of the point of watching. */
  readonly onToolCallEnd?: (call: ToolCall, result: string, durationMs: number) => void;
};

export type AgentDependencies = {
  readonly model: ModelPort;
  readonly tools: readonly Tool[];
  readonly observer?: AgentObserver;
  /** Aborts the whole run, in-flight HTTP request included. */
  readonly signal?: AbortSignal;
};

/**
 * Answer one question, and return the complete conversation it took to get there — the
 * question, each assistant Turn, and every tool result message in between.
 *
 * This is the seam. Give it a scripted `ModelPort` (first call returns a Turn with a Tool
 * Call, second returns one without) and it runs with no network and no keys.
 */
export async function runAgent(question: string, deps: AgentDependencies): Promise<Message[]> {
  const { model, tools, observer, signal } = deps;
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const messages: Message[] = [{ role: "user", content: question }];

  for (let index = 0; ; index++) {
    // Send the conversation so far. What comes back is one Turn: some text, some tool calls,
    // or both. Tokens arrive through the observer on the way; they are not the answer.
    const turn = await model.respond(messages, tools, { onToken: observer?.onToken, signal });
    observer?.onTurn?.(turn, index);

    // The turn joins the conversation whether or not it asked for anything.
    messages.push({ role: "assistant", content: turn.text, toolCalls: turn.toolCalls });

    // A Turn with no Tool Calls is the model saying it is done. That is all "finished" means.
    if (turn.toolCalls.length === 0) return messages;

    // A single Turn may carry several Tool Calls — parallel tool calling is on by default at
    // the provider — so run them all rather than only the first.
    const results = await Promise.all(turn.toolCalls.map((call) => dispatch(call, byName, observer, signal)));

    // Each result is its own message, quoting the id of the call it answers. Round again.
    messages.push(...results);
  }
}

async function dispatch(
  call: ToolCall,
  byName: ReadonlyMap<string, Tool>,
  observer: AgentObserver | undefined,
  signal: AbortSignal | undefined,
): Promise<Message> {
  const tool = byName.get(call.name);
  if (!tool) throw new UnknownToolError(call.name, [...byName.keys()]);

  observer?.onToolCallStart?.(call);
  const startedAt = Date.now();
  const content = await tool.run(call.args, signal);
  observer?.onToolCallEnd?.(call, content, Date.now() - startedAt);

  return { role: "tool", toolCallId: call.id, name: call.name, content };
}
