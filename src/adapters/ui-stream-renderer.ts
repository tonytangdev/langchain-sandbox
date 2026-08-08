/**
 * The other observer side of the hexagon: everything the run shows in a browser.
 *
 * This is a second implementation of the same `AgentObserver` the console renderer
 * implements, and the pair is the point — the Agent Loop did not learn about HTTP, about the
 * AI SDK, or about React in order to be watched from a web page. It gained a second watcher.
 *
 * Every hook here writes its chunks and returns. `writer.write` is synchronous and
 * fire-and-forget — it enqueues onto a stream that is already being consumed — so the
 * observer never awaits, never reorders, and never slows the loop down. That is what makes
 * "just call it from the callbacks" safe, and it is also what lets `onToken` be called once
 * per token from inside the model call without the loop noticing.
 *
 * The one thing this file has to get right is bracketing. Every `text-delta` must sit between
 * a `text-start` and a `text-end` carrying the same id — a delta for an unopened id is fatal
 * on the client, not a chunk it drops — which is why the open/close state is explicit below
 * rather than inferred from whichever hook happens to fire.
 */
import type { UIMessageStreamWriter } from "ai";
import type { AgentObserver } from "../domain/agent-loop.js";
import type { ToolCall } from "../domain/types.js";

/**
 * What a finished Tool Call carries to the client.
 *
 * The duration is here because it is most of the reason to watch a tool at all — a search
 * that took four seconds and a calculation that took two milliseconds read as the same event
 * without it. The client reads this shape back out of `part.output`, which the SDK types as
 * `unknown` for dynamic tools.
 */
export type ToolCallOutput = {
  readonly result: string;
  readonly durationMs: number;
};

/**
 * An observer that also knows how to open and close the stream it writes to.
 *
 * `begin` and `end` are not observer hooks because the loop has no concept of either: the
 * transport needs an opening chunk before any message exists and a closing chunk before the
 * response may complete, and neither is something the agent does.
 */
export type UIStreamRenderer = AgentObserver & {
  /** Write the opening chunk. Until this lands the client has no assistant message to fill. */
  readonly begin: () => void;
  /**
   * The terminal call, made on every path — answered, gave up, threw, or client hung up.
   *
   * Pass the error if the run ended with one. Any Tool Call that started and never returned
   * is closed out as failed here, which is the only place a thrown tool can be reported: the
   * loop has no "a tool threw" hook, because a throw leaves the loop entirely.
   */
  readonly end: (error?: unknown) => void;
};

export function uiStreamRenderer(writer: UIMessageStreamWriter): UIStreamRenderer {
  // Tool Calls that started and have not returned. A Turn may ask for several at once and
  // they run in parallel, so this is a set rather than a single slot.
  const inFlight = new Map<string, ToolCall>();
  let ended = false;

  // Which turn the tokens now arriving belong to. `onToken` fires *during* `model.respond`
  // and `onTurn` only *after* it, so the index the loop will eventually hand us is not
  // available when the first token needs an id — we count turns ourselves and resynchronise
  // from `onTurn`, which is authoritative.
  let turnIndex = 0;
  // Whether this turn's `start-step` has already been written. The boundary chunk has to
  // precede the turn's first token, so whichever of `onToken`/`onTurn` comes first opens it.
  let stepOpen = false;
  // The id of the text part currently open, or undefined if this turn has said nothing yet.
  // A `text-delta` for an id with no preceding `text-start` is fatal on the client, so this
  // is the invariant the whole file exists to keep.
  let textId: string | undefined;

  // The client is free to disconnect mid-run, and every write after that throws. Losing the
  // rest of a transcript nobody is reading is not worth failing a request over.
  const write = (chunk: Parameters<typeof writer.write>[0]): void => {
    try {
      writer.write(chunk);
    } catch {
      // Nobody left to tell.
    }
  };

  // Idempotent: a turn that is nothing but Tool Calls still gets its boundary, and a turn
  // that streamed text does not get a second one.
  const openStep = (): void => {
    if (stepOpen) return;
    stepOpen = true;
    write({ type: "start-step" });
  };

  const closeText = (): void => {
    if (textId === undefined) return;
    write({ type: "text-end", id: textId });
    textId = undefined;
  };

  return {
    begin: () => write({ type: "start" }),

    /**
     * One token of the current Turn's answer, while the model is still producing it.
     *
     * This is the earliest the browser hears about a turn at all, so it — not `onTurn` — is
     * what opens the turn boundary. The text part is opened lazily on the first token, so a
     * turn that only asks for tools never emits a dangling `text-start`/`text-end` pair.
     */
    onToken: (token) => {
      openStep();
      if (textId === undefined) {
        // Per turn, so several turns' answers stay separate parts rather than one growing
        // blob. Ids are only ever open one at a time, so reusing `turn-0` after a reset is
        // fine — the client keys on the part that was open when the delta arrived.
        textId = `turn-${turnIndex}`;
        write({ type: "text-start", id: textId });
      }
      write({ type: "text-delta", id: textId, delta: token });
    },

    /**
     * The Turn is complete. Its text has already been streamed above; this closes it and
     * resets the per-turn state so the next turn starts a fresh step and a fresh text part.
     *
     * The boundary is still written here when no token ever arrived, which keeps a pure
     * tool-call turn — and a ModelPort that does not stream at all — looking the same as before.
     */
    onTurn: (turn, index) => {
      openStep();

      // A ModelPort is allowed to return a Turn without ever calling `onToken` (a scripted
      // one in a test, say). Its text would otherwise vanish, so write it whole — the same
      // thing this hook did before the tokens existed.
      if (textId === undefined && turn.text !== "") {
        textId = `turn-${index}`;
        write({ type: "text-start", id: textId });
        write({ type: "text-delta", id: textId, delta: turn.text });
      }

      closeText();
      stepOpen = false;
      // The loop's index is authoritative; our own count is only the guess the first token
      // had to make. Resynchronising here means the two can never drift.
      turnIndex = index + 1;
    },

    /**
     * The model asked for a tool. `dynamic: true` is load-bearing: it makes the client
     * materialise a `dynamic-tool` part named at runtime. The statically-typed alternative
     * needs every tool name at compile time, and a Workflow chooses its toolset at runtime.
     */
    onToolCallStart: (call) => {
      inFlight.set(call.id, call);
      write({
        type: "tool-input-available",
        toolCallId: call.id,
        toolName: call.name,
        input: call.args,
        dynamic: true,
      });
    },

    onToolCallEnd: (call, result, durationMs) => {
      inFlight.delete(call.id);
      const output: ToolCallOutput = { result, durationMs };
      write({ type: "tool-output-available", toolCallId: call.id, output, dynamic: true });
    },

    /**
     * The loop stopped because it ran out of turns, not because it answered.
     *
     * Reported on the error channel even though the run ended normally: the transcript above
     * it is worth reading and stays on screen, but "no answer arrived" should not look like
     * an answer that happened to be empty.
     */
    onGaveUp: (iterations) => {
      write({
        type: "error",
        errorText: `The agent was still asking for tools after ${iterations} turns, so it stopped without answering.`,
      });
    },

    end: (error) => {
      if (ended) return;
      ended = true;

      // A run that died mid-token — aborted, timed out, thrown — leaves a text part open,
      // and the client keeps it in the "streaming" state forever if nothing closes it. What
      // arrived stays on screen; it just stops claiming there is more coming.
      closeText();

      // A tool that threw takes the whole run with it, so whatever was still running is what
      // failed. With one call in flight — the usual case — this names it exactly; with
      // several running in parallel we cannot tell which one threw, so all of them carry the
      // run's error rather than one of them silently staying "running" forever.
      const errorText = error === undefined ? "The run ended before this tool returned." : describe(error);
      for (const call of inFlight.values()) {
        write({ type: "tool-output-error", toolCallId: call.id, errorText, dynamic: true });
      }
      inFlight.clear();

      if (error !== undefined) write({ type: "error", errorText: describe(error) });

      // The response stays open until this lands, which is why `end` is called from a
      // `finally` and why it is idempotent.
      write({ type: "finish" });
    },
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
