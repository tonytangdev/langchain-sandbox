/**
 * Composition root. The only file that knows about every other file.
 *
 * Everything vendor-shaped is constructed here — or, for the parts the web route needs too,
 * in `adapters/workflow-runtime.ts` — and handed to the loop as ports, so the line between
 * "my logic" and "the vendor's" is visible by reading this one function.
 */
import { consoleObserver, printConversation } from "./adapters/console-renderer.js";
import { assertWorkflowsRunnable, resolveWorkflow, workflowRuntimeFromEnv } from "./adapters/workflow-runtime.js";
import { runAgent } from "./domain/agent-loop.js";
import type { Message } from "./domain/types.js";
import type { Workflow } from "./domain/workflows.js";
import { DEFAULT_WORKFLOW, findWorkflow, workflowNames } from "./domain/workflows.js";

/**
 * One deadline for the whole run, not one per request.
 *
 * Per-request timeouts are the vendor's job and would hide the seam. This is the operator's
 * question — "how long may this cost me" — and it is asked once, of the run as a whole.
 */
const DEADLINE_MS = 60_000;

const USAGE =
  `Usage: npm run cli -- [--workflow <name>] "your question"\n` +
  `Workflows: ${workflowNames().join(", ")} (default: ${DEFAULT_WORKFLOW.name})\n`;

async function main(): Promise<void> {
  // Every definition is checked before anything else happens, so a workflow naming a model
  // this build cannot run fails now — not when someone eventually selects it and asks a
  // question, by which point the error reads like a provider outage.
  assertWorkflowsRunnable();

  const args = parseArgs(process.argv.slice(2));
  if (args === undefined || args.question === "") {
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }

  const workflow = findWorkflow(args.workflowName ?? DEFAULT_WORKFLOW.name);
  if (workflow === undefined) {
    process.stderr.write(`Unknown workflow: ${args.workflowName}\n${USAGE}`);
    process.exitCode = 2;
    return;
  }

  // The workflow decides the model, the tools and the system prompt; the run decides the rest.
  // Resolving names to ports happens in one place both this root and the web route go through.
  const { model, tools, systemPrompt } = resolveWorkflow(workflow, workflowRuntimeFromEnv());
  announce(workflow, tools.map((tool) => tool.name));

  // A single AbortController for the run. Its signal is threaded through ModelPort into the
  // underlying HTTP request, so the deadline actually stops work rather than abandoning a
  // promise that keeps billing in the background.
  const controller = new AbortController();
  let deadlineFired = false;
  const timer = setTimeout(() => {
    deadlineFired = true;
    controller.abort();
  }, DEADLINE_MS);

  // The loop is driven by a conversation; the CLI's is one question long, and building it
  // here is the whole of what "one-shot" means now.
  const seed: Message[] = [{ role: "user", content: args.question }];

  // Kept out here so a run that dies half way still has a conversation to show. A failed run
  // is the one you most want to read the shapes of, and the return value never arrives.
  const conversation: Message[] = [...seed];

  try {
    await runAgent(seed, {
      model,
      tools,
      systemPrompt,
      observer: { ...consoleObserver(), onMessage: (message) => conversation.push(message) },
      signal: controller.signal,
    });
  } catch (error) {
    printConversation(conversation);

    // A timeout should read as a timeout, not as a crash. The deadline is what we know, so
    // that is what we test — not the error type, which depends on where the abort landed.
    if (deadlineFired) {
      process.stderr.write(`\nTimed out: the run passed its ${DEADLINE_MS / 1000}s deadline and was aborted.\n`);
      process.exitCode = 1;
      return;
    }

    // Everything else keeps its stack: while learning, seeing what broke beats a tidy
    // message that hides it.
    throw error;
  } finally {
    clearTimeout(timer);
  }

  printConversation(conversation);
}

type Args = { readonly workflowName?: string; readonly question: string };

/**
 * `--workflow <name>` (or `--workflow=<name>`) anywhere; everything else is the question.
 *
 * A flag rather than a positional first argument, because a bare `Math` is both a plausible
 * workflow name and a plausible start to a question, and guessing which would misread one of
 * them silently. Returns `undefined` when the flag is given without a name.
 */
function parseArgs(argv: readonly string[]): Args | undefined {
  const words: string[] = [];
  let workflowName: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--workflow" || arg === "-w") {
      const value = argv[++i];
      if (value === undefined) return undefined;
      workflowName = value;
      continue;
    }
    if (arg.startsWith("--workflow=")) {
      workflowName = arg.slice("--workflow=".length);
      continue;
    }
    words.push(arg);
  }

  return { workflowName, question: words.join(" ").trim() };
}

/**
 * Say which workflow is answering and with what, before the first token.
 *
 * The point of workflows is watching the same question answered differently, which only
 * reads if the transcript says what was in force — particularly the tool list, since a
 * workflow's refusal to search is a tool that is absent rather than anything it says.
 */
function announce(workflow: Workflow, toolNames: readonly string[]): void {
  process.stdout.write(
    `[2m[workflow] ${workflow.name} — model ${workflow.modelId} — tools: ${toolNames.join(", ")}[0m\n`,
  );
}

await main();
