/**
 * The observer side of the hexagon: everything the run prints.
 *
 * Observability is stdout at this stage — no hosted tracing — so this file is the entire
 * answer to "what did the agent do". It is an adapter rather than domain code because the
 * loop should not care whether anyone is watching.
 */
import type { AgentObserver } from "../domain/agent-loop.js";
import type { Message } from "../domain/types.js";

const DIM = "[2m";
const BOLD = "[1m";
const RESET = "[0m";

export function consoleObserver(): AgentObserver {
  // A Turn's tokens and its tool-call banners share stdout, so track whether we are
  // mid-sentence and only break the line when there is actually something to break.
  let midLine = false;
  const breakLine = () => {
    if (midLine) process.stdout.write("\n");
    midLine = false;
  };

  return {
    onToken: (token) => {
      process.stdout.write(token);
      midLine = true;
    },

    onTurn: (turn, index) => {
      breakLine();
      const shape =
        turn.toolCalls.length === 0
          ? "no tool calls — the loop ends here"
          : `${turn.toolCalls.length} tool call(s)`;
      process.stdout.write(`${DIM}[turn ${index}] ${shape}${RESET}\n`);
    },

    onToolCallStart: (call) => {
      breakLine();
      process.stdout.write(`${BOLD}  → ${call.name}${RESET}(${JSON.stringify(call.args)})\n`);
    },

    onToolCallEnd: (call, result, durationMs) => {
      process.stdout.write(`${DIM}  ← ${call.name} returned in ${durationMs}ms: ${preview(result)}${RESET}\n`);
    },
  };
}

/**
 * Print the whole conversation, unabbreviated.
 *
 * The point of the run is to see these shapes rather than read a description of them, so
 * nothing here is truncated and nothing is prettified into something the model never saw.
 */
export function printConversation(messages: readonly Message[]): void {
  process.stdout.write(`\n${BOLD}--- the whole conversation ---${RESET}\n`);
  console.dir(messages, { depth: null, maxStringLength: null, maxArrayLength: null });
}

function preview(result: string, limit = 140): string {
  const flat = result.replace(/\s+/gu, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`;
}
