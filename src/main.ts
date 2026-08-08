/**
 * Composition root. The only file that knows about every other file.
 *
 * Everything vendor-shaped is constructed here and handed to the loop as ports, so the line
 * between "my logic" and "the vendor's" is visible by reading this one function.
 */
import { consoleObserver, printConversation } from "./adapters/console-renderer.js";
import { requireEnv } from "./adapters/env.js";
import { openRouterModel } from "./adapters/openrouter-model.js";
import { tavilySearch } from "./adapters/tavily-search.js";
import { runAgent } from "./domain/agent-loop.js";
import { addTool } from "./domain/tools/add.js";
import { webSearchTool } from "./domain/tools/web-search.js";
import type { Message } from "./domain/types.js";

/**
 * One deadline for the whole run, not one per request.
 *
 * Per-request timeouts are the vendor's job and would hide the seam. This is the operator's
 * question — "how long may this cost me" — and it is asked once, of the run as a whole.
 */
const DEADLINE_MS = 60_000;

async function main(): Promise<void> {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    process.stderr.write('Usage: npm start -- "your question"\n');
    process.exitCode = 2;
    return;
  }

  const model = openRouterModel({ apiKey: requireEnv("OPENROUTER_API_KEY"), siteName: "langchain-sandbox" });
  const search = tavilySearch({ apiKey: requireEnv("TAVILY_API_KEY") });

  // A single AbortController for the run. Its signal is threaded through ModelPort into the
  // underlying HTTP request, so the deadline actually stops work rather than abandoning a
  // promise that keeps billing in the background.
  const controller = new AbortController();
  let deadlineFired = false;
  const timer = setTimeout(() => {
    deadlineFired = true;
    controller.abort();
  }, DEADLINE_MS);

  // Kept out here so a run that dies half way still has a conversation to show. A failed run
  // is the one you most want to read the shapes of, and the return value never arrives.
  const conversation: Message[] = [];

  try {
    await runAgent(question, {
      model,
      tools: [addTool, webSearchTool(search)],
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

await main();
