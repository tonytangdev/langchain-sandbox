/**
 * SearchPort backed by a locally-run SearXNG instance.
 *
 * The second implementation of the port, and the first time the abstraction pays for itself:
 * the Tool, the port and the Agent Loop are untouched, and the Model sees the same three
 * fields either way. SearXNG is a metasearch front end — it holds no API key of its own, which
 * is the whole reason it is here.
 *
 * Hand-written against `fetch` rather than taken from `@langchain/community`, which is
 * deprecated and archived read-only.
 */
import { AbortedError, SearchError } from "../domain/errors.js";
import type { SearchPort, SearchResult } from "../domain/ports.js";
import { isAbort, messageOf } from "./vendor-errors.js";

export type SearxngSearchConfig = {
  /** Root of the instance, e.g. `http://localhost:8080`. Any path on it is kept. */
  readonly baseUrl: string;
  readonly maxResults?: number;
};

export function searxngSearch(config: SearxngSearchConfig): SearchPort {
  // Parsed once, here, so a typo in SEARXNG_URL fails at startup next to the variable that
  // caused it rather than mid-run as a confusing fetch error.
  const endpoint = searchEndpoint(config.baseUrl);
  const maxResults = config.maxResults ?? 5;

  return {
    search: async (query, signal) => {
      const url = new URL(endpoint);
      url.searchParams.set("q", query);
      // Returns 403 until `json` is added to `search.formats` in settings.yml. The default
      // config allows only html, so this is the first thing a fresh instance gets wrong.
      url.searchParams.set("format", "json");

      let response: Response;
      try {
        response = await fetch(url, { signal });
      } catch (cause) {
        if (isAbort(cause, signal)) {
          throw new AbortedError("The run was aborted while waiting on the search provider.", { cause });
        }
        throw new SearchError(`SearXNG at ${endpoint.origin} could not be reached: ${messageOf(cause)}`, { cause });
      }

      const body = await readBody(response, signal);

      if (!response.ok) {
        if (response.status === 403) {
          throw new SearchError(
            `SearXNG at ${endpoint.origin} refused the JSON format (HTTP 403). Add "json" to ` +
              `search.formats in its settings.yml and restart it.`,
          );
        }
        throw new SearchError(`SearXNG at ${endpoint.origin} answered HTTP ${response.status}: ${excerpt(body)}`);
      }

      let raw: unknown;
      try {
        raw = JSON.parse(body);
      } catch (cause) {
        throw new SearchError(
          `SearXNG at ${endpoint.origin} answered with something that is not JSON: ${excerpt(body)}`,
          { cause },
        );
      }

      if (!isRecord(raw) || !Array.isArray(raw["results"])) {
        throw new SearchError(`SearXNG returned a shape this adapter does not recognise: ${excerpt(body)}`);
      }

      // A degraded instance answers 200 with an empty `results` array rather than an error:
      // upstream engines start blocking it after a burst of queries. Handed to the model as an
      // empty list that would read as "the web knows nothing about this", so it is raised
      // instead, naming the engines that dropped out — that is the actionable part.
      if (raw["results"].length === 0) {
        throw new SearchError(
          `SearXNG at ${endpoint.origin} returned no results for "${query}". ` +
            `Unresponsive engines: ${describeUnresponsive(raw["unresponsive_engines"])}.`,
        );
      }

      return raw["results"].slice(0, maxResults).map(toResult);
    },
  };
}

/** `http://host:8080` and `http://host:8080/searxng/` both have to land on `…/search`. */
function searchEndpoint(baseUrl: string): URL {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch (cause) {
    throw new SearchError(`SEARXNG_URL is not a URL: ${baseUrl}`, { cause });
  }
  // `new URL("localhost:8080")` parses happily, as a URL whose scheme is "localhost". Without
  // this the mistake survives to `fetch` and comes back as a bare "fetch failed".
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new SearchError(`SEARXNG_URL must start with http:// or https://, but is: ${baseUrl}`);
  }
  base.pathname = base.pathname.endsWith("/") ? `${base.pathname}search` : `${base.pathname}/search`;
  return base;
}

/**
 * Read the body as text before deciding anything about it.
 *
 * `response.json()` would collapse "the instance is down and served an HTML error page" into a
 * parse error with none of the page in it, and the page is the only clue about what happened.
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

/** `unresponsive_engines` is a list of `[engine, reason]` pairs, and is absent when all is well. */
function describeUnresponsive(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "none reported, so every engine simply found nothing";
  return value
    .map((entry) => {
      if (!Array.isArray(entry)) return String(entry);
      const [engine, reason] = entry;
      return reason === undefined ? String(engine) : `${String(engine)} (${String(reason)})`;
    })
    .join(", ");
}

/** Narrow the provider's loose shape to the three fields the port promises. */
function toResult(result: unknown): SearchResult {
  const source = isRecord(result) ? result : {};
  return {
    title: asString(source["title"]),
    url: asString(source["url"]),
    // SearXNG's `content` is a search-result snippet rather than Tavily's extracted page text.
    // Same field, shorter answer — accepted when this adapter was chosen.
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
