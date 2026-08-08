/**
 * ModelPort backed by LangChain's `ChatOpenRouter`.
 *
 * This file is the only place in the project that knows LangChain exists on the model side.
 * ADR 0002 puts it here precisely so the vendor API churn the docs are full of — `modelName`
 * becoming `model`, `configuration.baseURL` becoming `baseURL` — can break this file and
 * nothing else.
 */
import type { AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { ChatOpenRouter } from "@langchain/openrouter";
import { AbortedError, ModelError } from "../domain/errors.js";
import type { ModelPort } from "../domain/ports.js";
import type { Message, Tool, ToolCall, Turn } from "../domain/types.js";

export type OpenRouterModelConfig = {
  readonly apiKey: string;
  /**
   * Defaults to `moonshotai/kimi-k3`, verified present and tool-capable on OpenRouter's live
   * model list. Note that `parallel_tool_calls` defaults to true there, so one Turn may
   * legitimately carry several Tool Calls — which is why the loop runs them as a set.
   */
  readonly model?: string;
  /** Optional OpenRouter attribution only; nothing depends on it. */
  readonly siteName?: string;
  /**
   * Defaults to OpenRouter. Overridable so this adapter can be pointed at a stub server —
   * the ModelPort fake covers the loop, but nothing else covers the vendor wiring in here.
   */
  readonly baseURL?: string;
};

export function openRouterModel(config: OpenRouterModelConfig): ModelPort {
  const chat = new ChatOpenRouter({
    model: config.model ?? "moonshotai/kimi-k3",
    apiKey: config.apiKey,
    siteName: config.siteName,
    baseURL: config.baseURL,
  });

  return {
    respond: async (messages, tools, options = {}) => {
      const bound = chat.bindTools(tools.map(toBoundTool));
      // The signal is the only part of LangChain's (much wider) config object we set — it is
      // what makes the run's deadline reach the in-flight HTTP request.
      const stream = await callVendor(
        () => bound.stream(messages.map(toVendorMessage), { signal: options.signal }),
        options.signal,
      );

      // Consume the stream for two different reasons at once: the tokens are for whoever is
      // watching, and the accumulated chunk is the Turn. `concat` is what turns a run of
      // fragments — including partial tool-call argument JSON — back into one whole message.
      let accumulated: AIMessageChunk | undefined;
      await callVendor(async () => {
        for await (const chunk of stream) {
          if (chunk.text) options.onToken?.(chunk.text);
          accumulated = accumulated === undefined ? chunk : accumulated.concat(chunk);
        }
      }, options.signal);

      if (accumulated === undefined) {
        throw new ModelError("The model returned an empty response — no tokens and no tool calls.");
      }
      return toTurn(accumulated);
    },
  };
}

/**
 * A tool as the vendor wants it: the declaration only.
 *
 * The handler is deliberately not handed over. LangChain would happily run tools for us, and
 * that is exactly the step this project exists to watch, so the loop keeps it.
 */
function toBoundTool(tool: Tool) {
  return { name: tool.name, description: tool.description, schema: tool.schema };
}

function toVendorMessage(message: Message): BaseMessage {
  switch (message.role) {
    case "user":
      return new HumanMessage(message.content);
    case "assistant":
      return new AIMessage({
        content: message.content,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          name: call.name,
          args: { ...call.args },
          type: "tool_call" as const,
        })),
      });
    case "tool":
      return new ToolMessage({
        tool_call_id: message.toolCallId,
        name: message.name,
        content: message.content,
      });
  }
}

function toTurn(chunk: AIMessageChunk): Turn {
  const toolCalls: ToolCall[] = (chunk.tool_calls ?? []).map((call, position) => ({
    // The provider always sends an id, but the type says it may not. A tool result message
    // is useless without one to quote back, so fall back to something stable rather than "".
    id: call.id ?? `${chunk.id ?? "turn"}-${position}`,
    name: call.name,
    args: call.args ?? {},
  }));
  return { text: chunk.text, toolCalls };
}

/**
 * Re-derive meaning from whatever the vendor threw.
 *
 * ADR 0001 gave up a typed error channel, so this is where the bill comes due: the boundary
 * has to sort untagged throws into the domain's vocabulary by hand. There is no retry — a
 * transient failure is more useful visible than smoothed over.
 */
async function callVendor<T>(action: () => Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  try {
    return await action();
  } catch (cause) {
    if (signal?.aborted || isAbort(cause)) {
      throw new AbortedError("The run was aborted while waiting on the model.", { cause });
    }
    throw new ModelError(describe(cause), { cause });
  }
}

function isAbort(cause: unknown): boolean {
  return cause instanceof Error && (cause.name === "AbortError" || cause.name === "APIUserAbortError");
}

function describe(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  const status = cause instanceof Error ? (cause as { statusCode?: number }).statusCode : undefined;

  if (status === 401 || status === 403) {
    return `OpenRouter rejected the credential (HTTP ${status}). Check OPENROUTER_API_KEY. ${message}`;
  }
  if (status === 429) {
    return `OpenRouter is rate limiting this key (HTTP 429). This is not retried on purpose. ${message}`;
  }
  return `The model call failed: ${message}`;
}
