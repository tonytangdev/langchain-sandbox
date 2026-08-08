/**
 * SearchPort backed by Tavily's HTTP API.
 *
 * The only place in the project that knows which search provider we use. Swapping Tavily for
 * something else is a new file next to this one.
 *
 * Hand-written against `fetch` rather than taken from `@langchain/tavily`, and that is a
 * cancellation decision rather than a taste one. `TavilySearch` accepts a `signal` in its
 * runnable config, which reads as if it cancels the search — LangChain only checks it *between*
 * runnable steps, and the wrapper underneath calls `fetch` with no signal at all. So a stopped
 * run left the search request running to completion and still being paid for, while the loop
 * sat waiting for it: the exact "it looked like it stopped" bug. `fetch(url, { signal })` here
 * is one line and actually tears the connection down. The SearXNG adapter next door was already
 * written this way, for its own reasons; the two now agree.
 */
import { AbortedError, SearchError } from "../domain/errors.js";
import type { SearchPort, SearchResult } from "../domain/ports.js";
import { isAbort, messageOf } from "./vendor-errors.js";

const ENDPOINT = "https://api.tavily.com/search";

export type TavilySearchConfig = {
  readonly apiKey: string;
  readonly maxResults?: number;
};

export function tavilySearch(config: TavilySearchConfig): SearchPort {
  const maxResults = config.maxResults ?? 5;

  return {
    search: async (query, signal) => {
      let response: Response;
      try {
        response = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ query, max_results: maxResults }),
          signal,
        });
      } catch (cause) {
        if (isAbort(cause, signal)) {
          throw new AbortedError("The run was aborted while waiting on the search provider.", { cause });
        }
        throw new SearchError(`Tavily could not be reached: ${messageOf(cause)}`, { cause });
      }

      // Read as text before deciding anything, so "the provider is down and served an HTML
      // error page" keeps the page — which is the only clue about what happened — instead of
      // collapsing into a parse error with nothing in it.
      const body = await readBody(response, signal);

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new SearchError(`Tavily rejected the credential (HTTP ${response.status}). Check TAVILY_API_KEY.`);
        }
        throw new SearchError(`Tavily answered HTTP ${response.status}: ${excerpt(body)}`);
      }

      let raw: unknown;
      try {
        raw = JSON.parse(body);
      } catch (cause) {
        throw new SearchError(`Tavily answered with something that is not JSON: ${excerpt(body)}`, { cause });
      }

      // Tavily reports some failures inside a 200 body. Unhandled it reaches the model as a
      // plausible-looking search result, and errors are supposed to be visible here.
      if (isRecord(raw) && typeof raw["error"] === "string") {
        throw new SearchError(`Tavily reported: ${raw["error"]}`);
      }
      if (!isRecord(raw) || !Array.isArray(raw["results"])) {
        throw new SearchError(`Tavily returned a shape this adapter does not recognise: ${excerpt(body)}`);
      }

      return raw["results"].slice(0, maxResults).map(toResult);
    },
  };
}

/**
 * The body arrives in chunks, so this is a second place the run can be cancelled — after the
 * headers came back but before the answer is whole.
 */
async function readBody(response: Response, signal: AbortSignal | undefined): Promise<string> {
  try {
    return await response.text();
  } catch (cause) {
    if (isAbort(cause, signal)) {
      throw new AbortedError("The run was aborted while reading the search provider's answer.", { cause });
    }
    throw new SearchError(`The search response could not be read: ${messageOf(cause)}`, { cause });
  }
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

/** Enough of an unexpected body to recognise it, without pasting a whole HTML page into stderr. */
function excerpt(body: string): string {
  const trimmed = body.trim();
  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
