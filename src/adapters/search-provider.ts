/**
 * Which search Provider a run uses, decided from the environment.
 *
 * Lives here rather than in a composition root because both roots — the CLI and the web
 * route — need the same answer, and an environment read duplicated in two places is an
 * environment read that will eventually disagree with itself.
 */
import type { SearchPort } from "../domain/ports.js";
import { requireEnv } from "./env.js";
import { searxngSearch } from "./searxng-search.js";
import { tavilySearch } from "./tavily-search.js";

/**
 * SearXNG if one was pointed at, Tavily otherwise.
 *
 * `SEARXNG_URL` is read directly rather than through `requireEnv`, which throws on absence —
 * absence is the answer here. The Tavily key is only asked for on the branch that needs it,
 * so a SearXNG run needs no vendor credential at all.
 *
 * @throws {MissingCredentialError} if neither a SearXNG url nor a Tavily key is set.
 */
export function searchFromEnv(): SearchPort {
  const searxngUrl = process.env["SEARXNG_URL"]?.trim();
  return searxngUrl ? searxngSearch({ baseUrl: searxngUrl }) : tavilySearch({ apiKey: requireEnv("TAVILY_API_KEY") });
}
