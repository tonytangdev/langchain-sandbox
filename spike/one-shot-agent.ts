/**
 * Stage 1 — Spike.
 *
 * The whole agent in one file, with no structure at all: no ports, no adapters, no domain
 * types. Everything talks directly to LangChain. This exists to make the Agent Loop legible
 * in one screenful — read it top to bottom and you have seen every mechanic the words "agent",
 * "tool" and "tool call" refer to.
 *
 * `src/` is the same behaviour rebuilt as a hexagon (Stage 2 — Skeleton). This file is
 * throwaway by intent; it is kept because it is the shortest honest answer to "how does an
 * agent work", and deleting it would cost that.
 *
 *   npm run spike -- "What is 2 + 3, and who won the 2024 Ballon d'Or?"
 */
import { HumanMessage, ToolMessage, type AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import { ChatOpenRouter } from "@langchain/openrouter";
import { TavilySearch } from "@langchain/tavily";
import { z } from "zod";

// ---------------------------------------------------------------------------
// The two tools. A tool is a declaration (name, description, parameter schema)
// paired with an implementation. The model never runs one; it only asks us to.
// ---------------------------------------------------------------------------

const tavily = new TavilySearch({ maxResults: 5 });

const tools = {
  add: {
    description: "Add two numbers together and return the sum.",
    schema: z.object({
      a: z.number().describe("The first number to add."),
      b: z.number().describe("The second number to add."),
    }),
    handler: async ({ a, b }: { a: number; b: number }) => String(a + b),
  },
  web_search: {
    description:
      "Search the web for current information. Use this for anything you do not already know, " +
      "or anything that may have changed recently.",
    schema: z.object({
      query: z.string().describe("The search query, phrased as you would type it into a search engine."),
    }),
    handler: async ({ query }: { query: string }) => JSON.stringify(await tavily.invoke({ query }, {})),
  },
} as const;

type ToolName = keyof typeof tools;

// ---------------------------------------------------------------------------
// The model, with the tool declarations bound to it.
// ---------------------------------------------------------------------------

const model = new ChatOpenRouter({
  model: "moonshotai/kimi-k3",
  apiKey: process.env["OPENROUTER_API_KEY"] ?? "",
}).bindTools(
  Object.entries(tools).map(([name, t]) => ({ name, description: t.description, schema: t.schema })),
);

// ---------------------------------------------------------------------------
// The Agent Loop.
// ---------------------------------------------------------------------------

const question = process.argv.slice(2).join(" ");
if (!question) throw new Error('Usage: npm run spike -- "your question"');

const deadline = new AbortController();
const timer = setTimeout(() => deadline.abort(), 60_000);

const messages: BaseMessage[] = [new HumanMessage(question)];

while (true) {
  // 1. Send the conversation so far. Stream so tokens appear as they are produced —
  //    the accumulated chunk at the end is an ordinary AIMessage.
  let turn: AIMessageChunk | undefined;
  for await (const chunk of await model.stream(messages, { signal: deadline.signal })) {
    process.stdout.write(chunk.text);
    turn = turn === undefined ? chunk : turn.concat(chunk);
  }
  if (!turn) throw new Error("The model returned no chunks at all.");

  // 2. The turn goes into the conversation whether or not it asked for tools.
  messages.push(turn);

  // 3. No tool calls means the model is done talking. This is what "finished" means.
  if (turn.tool_calls === undefined || turn.tool_calls.length === 0) break;

  // 4. One turn can ask for several tools at once, so run them all.
  const results = await Promise.all(
    turn.tool_calls.map(async (call) => {
      console.log(`\n  → ${call.name}(${JSON.stringify(call.args)})`);
      const started = Date.now();
      const tool = tools[call.name as ToolName];
      if (!tool) throw new Error(`The model asked for a tool that does not exist: ${call.name}`);
      const content = await tool.handler(tool.schema.parse(call.args) as never);
      console.log(`  ← ${call.name} in ${Date.now() - started}ms: ${content.slice(0, 120)}`);
      return new ToolMessage({ tool_call_id: call.id ?? "", name: call.name, content });
    }),
  );

  // 5. Results go back as their own messages, and round we go again.
  messages.push(...results);
}

clearTimeout(timer);

console.log("\n\n--- the whole conversation ---");
console.dir(
  messages.map((m) => m.toDict()),
  { depth: null },
);
