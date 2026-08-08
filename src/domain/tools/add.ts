import { z } from "zod";
import { defineTool } from "../types.js";

/**
 * The control.
 *
 * `add` exists to make failures attributable. If the model calls `add(2, 3)` and gets `5`,
 * the tool plumbing is definitively correct — schema out, arguments in, result back, model
 * uses it — and anything odd after that is the model or the search, not the wiring.
 */
export const addTool = defineTool({
  name: "add",
  description: "Add two numbers together and return their sum.",
  schema: z.object({
    // Every parameter carries a description because the description is the only thing the
    // model sees explaining what the parameter means.
    a: z.number().describe("The first number to add."),
    b: z.number().describe("The second number to add."),
  }),
  handler: ({ a, b }) => String(a + b),
});
