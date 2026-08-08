import {
  consumeStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  safeValidateUIMessages,
  type UIMessage,
} from "ai";

import { conversationFromUIMessages } from "@/src/adapters/ui-message-history.js";
import { uiStreamRenderer } from "@/src/adapters/ui-stream-renderer.js";
import { assertWorkflowsRunnable, resolveWorkflow, workflowRuntimeFromEnv } from "@/src/adapters/workflow-runtime.js";
import { runAgent } from "@/src/domain/agent-loop.js";
import { DEFAULT_WORKFLOW, findWorkflow, workflowNames } from "@/src/domain/workflows.js";

/**
 * Composition root #2. The CLI is #1 (`src/main.ts`) and this makes the same three calls, in
 * the same order, for the same reasons — that symmetry is the evidence that the browser and
 * the terminal are running one agent rather than two that happen to agree.
 *
 * Both of these are module scope, which is to say startup: a workflow naming a model this
 * build cannot run, or a missing credential, fails when the server boots rather than when
 * somebody eventually asks a question and reads it as a provider outage. Building the runtime
 * once also means every request shares one search adapter instead of one per question.
 */
assertWorkflowsRunnable();
const runtime = workflowRuntimeFromEnv();

/**
 * This route's own whole-run deadline.
 *
 * The CLI has one too, and the duplicated `60_000` is deliberate rather than a constant
 * waiting to be shared: a deadline is an operator decision about *this* entry point, and
 * `src/main.ts`'s belongs to a terminal session someone is watching. Importing it would make
 * the web inherit an answer to a question nobody asked of the web. The two are free to differ.
 */
const DEADLINE_MS = 60_000;

/**
 * A run that outlived {@link DEADLINE_MS}.
 *
 * Its own type only so the browser is told "timed out" rather than the domain's
 * `AbortedError`, which deliberately says no more than "we were cancelled" — the domain cannot
 * know *why* a signal fired, and only this file does. The wording mirrors the CLI's
 * `Timed out: …` line for the same reason: a deadline should read as a deadline and not as a
 * crash, whichever root you hit it from.
 */
class DeadlineExceededError extends Error {
  constructor(ms: number) {
    super(`the run passed its ${ms / 1000}s deadline and was aborted.`);
    // The renderer prints `${name}: ${message}`, so the name carries half the sentence.
    this.name = "Timed out";
  }
}

/**
 * How large a conversation this route will run.
 *
 * The browser owns the transcript and posts the whole thing with every question, so what
 * arrives here is untrusted input that we then pay a model to read. 100k characters is roughly
 * 25k tokens — generous for a demo, and enough to bound one request's input cost to cents
 * rather than dollars, which matters from localhost too and not only once deployed.
 *
 * Both caps refuse; neither trims. Dropping the oldest half to fit would produce "the agent
 * forgot what I said", which reads as a model failure and gets debugged in the wrong file
 * entirely — a refusal names the actual problem to the person who can fix it.
 */
const MAX_MESSAGES = 50;
const MAX_CHARACTERS = 100_000;

export async function POST(request: Request): Promise<Response> {
  // Everything about the request is checked here, *before* the AbortController and the deadline
  // timer further down exist. Order matters rather than reads nicely: an early return past a
  // `setTimeout` would leave a 60-second timer burning for a request nobody is serving.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse("The request body is not valid JSON.");
  }

  if (typeof body !== "object" || body === null) {
    return refuse('The request body must be a JSON object with a "messages" array.');
  }

  // Read as `unknown` on purpose. A cast would be a claim about a stranger's JSON, and the
  // stranger is under no obligation to honour it; every field is checked before it is used.
  const { messages, workflow: requestedWorkflow } = body as { messages?: unknown; workflow?: unknown };

  // `workflow` is a *name*, never a definition. A client that could post a system prompt, a
  // model id and a tool list would be choosing which models we pay for and what capabilities
  // the agent has; naming an entry from a checked-in list means the worst a bad client can do
  // is name one that does not exist, which is the last refusal in this function.
  if (requestedWorkflow !== undefined && typeof requestedWorkflow !== "string") {
    return refuse(
      `"workflow" must be the name of a workflow, as a string. Known workflows: ${workflowNames().join(", ")}.`,
    );
  }

  // The SDK's own parser for the SDK's own wire format. `conversationFromUIMessages` is
  // defensive about *content* — it skips system messages and empty ones — but it assumes it is
  // being handed an array of messages that each have `parts`. This is what makes that true, so
  // a half-convertible body is refused whole rather than flattened into a conversation missing
  // the parts that failed to parse.
  const validated = await safeValidateUIMessages({ messages });
  if (!validated.success) {
    // Truncated because the SDK's message quotes the offending value back in full, and the
    // offending value can be a megabyte of it. The first line is where the useful part is.
    return refuse(`The conversation is not a valid message list: ${first(validated.error.message, 400)}`);
  }

  // Counted before the workflow is even looked up: an oversized body should cost us as little
  // as possible, and "which workflow" is not a question worth answering for a request that is
  // about to be refused.
  const messageCount = validated.data.length;
  if (messageCount > MAX_MESSAGES) {
    return refuse(
      `Conversation too long: ${messageCount} messages, ${messageCount - MAX_MESSAGES} over the limit of ` +
        `${MAX_MESSAGES}. Nothing was dropped to make it fit — start a new conversation to carry on.`,
    );
  }

  const characters = conversationCharacters(validated.data);
  if (characters > MAX_CHARACTERS) {
    return refuse(
      `Conversation too large: ${count(characters)} characters, ${count(characters - MAX_CHARACTERS)} over the ` +
        `limit of ${count(MAX_CHARACTERS)}. Nothing was truncated to make it fit — start a new conversation ` +
        "to carry on.",
    );
  }

  // The client posts its whole history every time, so a follow-up question arrives already
  // carrying what it is a follow-up to. That is the entire mechanism behind "the agent
  // remembers" — there is no session and nothing is persisted.
  const conversation = conversationFromUIMessages(validated.data);

  // Resolved per request, because the browser can switch workflows between questions and the
  // second question must run under the second workflow. Nothing about the selection is
  // remembered here — the request carries it, every time.
  //
  // An absent name is the CLI's `--workflow` being absent: run the default. A *present* name
  // that is not in the list is a client asking for something this build does not have, and it
  // is refused rather than quietly downgraded to the default — a silent fallback would answer
  // with the wrong tools and look like the model misbehaving.
  const workflow = requestedWorkflow === undefined ? DEFAULT_WORKFLOW : findWorkflow(requestedWorkflow);
  if (workflow === undefined) {
    return refuse(`Unknown workflow "${requestedWorkflow}". Known workflows: ${workflowNames().join(", ")}.`);
  }

  // The Workflow decides the model, the tools and the system prompt; the run decides the rest.
  const { model, tools, systemPrompt } = resolveWorkflow(workflow, runtime);

  // The server's own record of what it ran, mirroring the CLI's `[workflow] …` banner. Worth
  // the line: "did the switch actually take effect" is otherwise only answerable by inferring
  // it from which tools the model happened to call.
  console.log(`[workflow] ${workflow.name} — model ${workflow.modelId} — tools: ${workflow.toolNames.join(", ")}`);

  // One AbortController for the whole run, fired by three triggers: the client disconnecting,
  // this route's deadline, and the stop button — which is trigger one wearing a different hat,
  // because pressing stop aborts the browser's fetch and reaches us as a disconnect.
  //
  // Cancellation is cooperative. Nothing here can kill a running handler; it can only ask. The
  // asking works because this one signal goes into the Agent Loop, which already threads it
  // into every tool and into the model's in-flight HTTP request — so aborting cancels the
  // network call being paid for rather than only the rendering of it.
  const controller = new AbortController();

  // *Why* it fired, which the signal itself cannot carry. "Aborted" is not something to show a
  // person; "you stopped it" and "it ran too long" are, and this is the only place that knows
  // which. First trigger wins — a deadline that lands while the client is already gone changes
  // nothing about what happened.
  let firedBy: "client" | "deadline" | undefined;
  const abort = (trigger: "client" | "deadline"): void => {
    if (firedBy !== undefined) return;
    firedBy = trigger;
    controller.abort();
  };

  // The handler is *not* cancelled when the client goes away. The response stream is torn down,
  // but this function keeps running — and keeps billing the provider — until it returns, so the
  // disconnect has to be threaded in by hand. Nothing about it is automatic.
  //
  // Checked before subscribing as well as after: a request that was already abandoned by the
  // time we got here would otherwise never see the event, having missed it.
  if (request.signal.aborted) abort("client");
  else request.signal.addEventListener("abort", () => abort("client"), { once: true });

  const deadline = setTimeout(() => abort("deadline"), DEADLINE_MS);

  // The third way a run can stop, and the odd one out: the loop's iteration cap ends the run
  // *normally* rather than aborting it, so it must not read as a cancellation. Composed over
  // the renderer the way the CLI composes over its console observer.
  let gaveUpAfter: number | undefined;
  const startedAt = Date.now();

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const renderer = uiStreamRenderer(writer);
      renderer.begin();

      try {
        // The seed is the conversation so far and nothing else. Everything the loop adds to
        // it reaches the browser through the observer, chunk by chunk, as it happens.
        await runAgent(conversation, {
          model,
          tools,
          systemPrompt,
          observer: {
            ...renderer,
            onGaveUp: (iterations) => {
              gaveUpAfter = iterations;
              renderer.onGaveUp?.(iterations);
            },
          },
          signal: controller.signal,
        });
        renderer.end();
      } catch (error) {
        // Every way out of the loop ends up in `renderer.end`, because the response does not
        // complete until this function's promise settles and the closing chunk is written
        // there. A path that forgot to call it would hang the browser rather than fail it.
        //
        // The deadline's `AbortedError` is swapped for something that says "timed out": the
        // browser is still listening when a deadline fires — unlike a disconnect, where every
        // write is thrown away — so this is the one abort whose wording anybody reads.
        renderer.end(firedBy === "deadline" ? new DeadlineExceededError(DEADLINE_MS) : error);
      } finally {
        clearTimeout(deadline);
        // The server's own record of how the run ended, mirroring the `[workflow] …` banner
        // above. This is the line that answers "did closing the tab actually stop it, or is it
        // still running and billing" — which cannot be answered from the browser, the browser
        // having left.
        console.log(`[run] ${describeOutcome(firedBy, gaveUpAfter)} after ${Date.now() - startedAt}ms`);
      }
    },
    // Reached only if something outside the loop throws — the loop's own failures are already
    // reported as chunks above, with the tool that died marked as failed.
    onError: (error) => (error instanceof Error ? error.message : String(error)),
  });

  return createUIMessageStreamResponse({
    stream,
    // Also not automatic: once the client is gone nobody pulls the response body, the stream
    // stops being read, and `execute` parks forever on a write that is never drained — so the
    // `finally` above never runs, the deadline timer is never cleared, and the run we meant to
    // cancel leaks. Consuming a tee'd copy here keeps the stream draining regardless of who is
    // listening, which is what makes the disconnect path actually reach its end.
    consumeSseStream: consumeStream,
  });
}

/**
 * The one refusal shape this route has: plain text, 4xx, and a sentence a person can act on.
 *
 * The SDK's transport turns a non-ok response's body into the `error` the chat page already
 * renders in its one error line, so a refusal reaches the user as words with no UI to add. That
 * is also why each message says which limit was hit and by how much: "too large" alone leaves
 * the reader guessing whether to delete one message or fifty.
 */
function refuse(reason: string): Response {
  return new Response(reason, { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
}

/** The head of a message that may be arbitrarily long, since it can quote what was posted. */
function first(text: string, characters: number): string {
  return text.length <= characters ? text : `${text.slice(0, characters)}…`;
}

/** `104320` reads as a typo; `104,320` reads as a number. Only used in the refusals above. */
function count(characters: number): string {
  return characters.toLocaleString("en-US");
}

/**
 * The size of a conversation, counted in the only characters that cost anything: its text.
 *
 * The UI history also carries Tool Calls and their results, and `conversationFromUIMessages`
 * drops every one of them — they never reach the model, so counting them would refuse
 * conversations that are in fact cheap to run. What is measured here is what is sent.
 */
function conversationCharacters(messages: readonly UIMessage[]): number {
  let total = 0;
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "text") total += part.text.length;
    }
  }
  return total;
}

/** How the run ended, in the vocabulary the browser is shown, for the server log. */
function describeOutcome(firedBy: "client" | "deadline" | undefined, gaveUpAfter: number | undefined): string {
  if (firedBy === "client") return "stopped — the client disconnected (stop button, or the tab closed)";
  if (firedBy === "deadline") return `timed out — past the ${DEADLINE_MS / 1000}s deadline`;
  if (gaveUpAfter !== undefined) return `gave up — still asking for tools after ${gaveUpAfter} turns`;
  return "finished";
}
