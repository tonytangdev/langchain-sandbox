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
  /**
   * A message has joined the conversation. Only messages the loop produced — the caller
   * already holds the conversation it seeded the run with.
   *
   * The return value already carries the finished conversation, so this exists for the run
   * that *doesn't* finish: a caller that has been told each message as it landed can still
   * print the conversation after a timeout or a crash, which is exactly the run worth reading.
   */
  readonly onMessage?: (message: Message) => void;
  /**
   * The loop hit {@link MAX_ITERATIONS} and gave up while the model was still asking for
   * tools. Reported rather than thrown: the run ends normally, with a conversation worth
   * reading, and the caller decides how loudly to say the agent never finished.
   */
  readonly onGaveUp?: (iterations: number) => void;
  /** We are about to run a tool the model asked for. */
  readonly onToolCallStart?: (call: ToolCall) => void;
  /** That tool returned. `durationMs` is wall-clock, which is most of the point of watching. */
  readonly onToolCallEnd?: (call: ToolCall, result: string, durationMs: number) => void;
};

export type AgentDependencies = {
  readonly model: ModelPort;
  readonly tools: readonly Tool[];
  /**
   * What the agent has been told it is, sent ahead of the conversation on every turn.
   *
   * A dependency rather than a message the caller prepends, because it belongs to whoever
   * configured the agent, not to whoever is talking to it — the same place the model and the
   * tools come from.
   */
  readonly systemPrompt?: string;
  readonly observer?: AgentObserver;
  /** Aborts the whole run, in-flight HTTP request included. */
  readonly signal?: AbortSignal;
};

/**
 * The most turns one run may take before the loop gives up.
 *
 * Without it the only brake is the caller's deadline, so a model that loops on tool calls
 * keeps costing money for as long as it is allowed to run — which is as true from localhost
 * as it is in production.
 */
const MAX_ITERATIONS = 10;

/**
 * Continue a conversation until the model stops asking for tools, and return that whole
 * conversation — what it was seeded with, each assistant Turn, and every tool result message
 * in between.
 *
 * The seed is usually one user message, but a chat client sends its whole history, so the
 * loop takes the conversation rather than a question and leaves building it to the caller.
 *
 * This is the seam. Give it a scripted `ModelPort` (first call returns a Turn with a Tool
 * Call, second returns one without) and it runs with no network and no keys.
 */
export async function runAgent(
  conversation: readonly Message[],
  deps: AgentDependencies,
): Promise<Message[]> {
  const { model, tools, systemPrompt, observer, signal } = deps;
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  // Kept out of the conversation so it is not returned as something the user said, and
  // re-sent ahead of it on every turn: the model sees no history between calls.
  const preamble: Message[] = systemPrompt === undefined ? [] : [{ role: "system", content: systemPrompt }];

  const messages: Message[] = [...conversation];
  const record = (...added: Message[]) => {
    for (const message of added) {
      messages.push(message);
      observer?.onMessage?.(message);
    }
  };

  for (let index = 0; index < MAX_ITERATIONS; index++) {
    // Send the conversation so far. What comes back is one Turn: some text, some tool calls,
    // or both. Tokens arrive through the observer on the way; they are not the answer.
    const turn = await model.respond([...preamble, ...messages], tools, { onToken: observer?.onToken, signal });
    observer?.onTurn?.(turn, index);

    // The turn joins the conversation whether or not it asked for anything.
    record({ role: "assistant", content: turn.text, toolCalls: turn.toolCalls });

    // A Turn with no Tool Calls is the model saying it is done. That is all "finished" means.
    if (turn.toolCalls.length === 0) return messages;

    // A single Turn may carry several Tool Calls — parallel tool calling is on by default at
    // the provider — so run them all rather than only the first.
    const results = await Promise.all(turn.toolCalls.map((call) => dispatch(call, byName, observer, signal)));

    // Each result is its own message, quoting the id of the call it answers. Round again.
    record(...results);
  }

  // Falling out of the loop means the model asked for tools every single time. The
  // conversation is still worth having, so hand it back and say why it stops here.
  observer?.onGaveUp?.(MAX_ITERATIONS);
  return messages;
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
