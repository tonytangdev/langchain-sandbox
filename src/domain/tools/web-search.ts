import { z } from "zod";
import type { SearchPort } from "../ports.js";
import { defineTool } from "../types.js";

/**
 * The realistic one, and a Client Tool on purpose.
 *
 * The provider offers server-side web search, which would be less code and would work. It is
 * refused here because the Tool Call would never reach this process: the model would simply
 * come back better informed, and the step worth watching would happen invisibly.
 *
 * The tool takes its SearchPort as an argument rather than importing a provider, so swapping
 * search providers never touches this file or the loop.
 */
export function webSearchTool(search: SearchPort) {
  return defineTool({
    name: "web_search",
    description:
      "Search the web and return the top results. Use this for anything you are unsure of, " +
      "anything that may have changed recently, and anything after your training cutoff.",
    schema: z.object({
      query: z
        .string()
        .min(1)
        .describe("The search query, phrased the way you would type it into a search engine."),
    }),
    handler: async ({ query }, signal) => {
      const results = await search.search(query, signal);
      // The model reads this string. JSON keeps the field names visible, which is also what
      // makes the printed conversation legible at the end of a run.
      return JSON.stringify(results, null, 2);
    },
  });
}
