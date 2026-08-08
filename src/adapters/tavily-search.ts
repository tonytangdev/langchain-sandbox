/**
 * SearchPort backed by LangChain's `TavilySearch`.
 *
 * The only place in the project that knows which search provider we use. Swapping Tavily for
 * something else is a new file next to this one.
 */
import { TavilySearch } from "@langchain/tavily";
import { AbortedError, SearchError } from "../domain/errors.js";
import type { SearchPort, SearchResult } from "../domain/ports.js";
import { isAbort, messageOf } from "./vendor-errors.js";

export type TavilySearchConfig = {
  readonly apiKey: string;
  readonly maxResults?: number;
};

export function tavilySearch(config: TavilySearchConfig): SearchPort {
  const tool = new TavilySearch({
    tavilyApiKey: config.apiKey,
    maxResults: config.maxResults ?? 5,
  });

  return {
    search: async (query, signal) => {
      let raw: unknown;
      try {
        raw = await tool.invoke({ query }, { signal });
      } catch (cause) {
        if (isAbort(cause, signal)) {
          throw new AbortedError("The run was aborted while waiting on the search provider.", { cause });
        }
        throw new SearchError(`The search call failed: ${messageOf(cause)}`, { cause });
      }

      // `TavilySearch` catches its own failures and returns `{ error }` rather than throwing,
      // which would reach the model as a plausible-looking search result. Errors are supposed
      // to be visible here, so put it back.
      if (isRecord(raw) && typeof raw["error"] === "string") {
        throw new SearchError(`Tavily reported: ${raw["error"]}`);
      }
      if (!isRecord(raw) || !Array.isArray(raw["results"])) {
        throw new SearchError(`Tavily returned a shape this adapter does not recognise: ${JSON.stringify(raw)}`);
      }

      return raw["results"].map(toResult);
    },
  };
}

/** Narrow the provider's loose shape to the three fields the port promises. */
function toResult(result: unknown): SearchResult {
  const source = isRecord(result) ? result : {};
  return {
    title: asString(source["title"]),
    url: asString(source["url"]),
    content: asString(source["content"]),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
