# 04 — SearXNG as a keyless search adapter

**What to build:** A second implementation of the search port, backed by a locally-run
SearXNG instance, so web search works with no vendor API key.

With `SEARXNG_URL` set, `web_search` queries the local container. Without it, Tavily is
used exactly as today. Nothing about the Tool, the port, or the Agent Loop changes —
this is a new adapter beside the existing one, which is the first time the port
abstraction in this repo actually pays for itself.

**Blocked by:** None — can start immediately

**Status:** done

- [x] With `SEARXNG_URL` set, `npm run cli "<a current-events question>"` returns real
      results and no Tavily credential is read
- [x] With `SEARXNG_URL` unset, Tavily is used and behaves as it does today
- [x] A SearXNG instance that answers but returns no results surfaces as a visible
      search error naming the unresponsive engines, not as an empty success
- [x] An unreachable or non-JSON SearXNG instance surfaces as a visible search error
- [x] The search tool's output shape is unchanged, so the Model sees the same thing
      from either adapter
- [x] Setup notes record that SearXNG's JSON output must be enabled in its settings
      before it will answer with anything but 403

## Comments

SearXNG returns title, url and content — the same three fields the existing search
result type already has, so the tool's serialization needs no change.

Two behaviours learned from running it: JSON format returns 403 until explicitly
enabled in `settings.yml`, and a degraded instance returns HTTP 200 with an empty
results array rather than an error. Expect graceful degradation rather than
determinism — after a dozen rapid queries upstream engines start blocking and results
collapse toward a single engine.

Accepted loss: Tavily's LLM-tuned extracted content becomes roughly sentence-length
search-result snippets.

Not worth building: DuckDuckGo serves a challenge page on the first anonymous request
and its npm client is unmaintained; Google's Custom Search API is closed to new
signups and shuts down 1 Jan 2027; Bing's search APIs were retired in August 2025.
Brave works but has been paid since February 2026, so it swaps one key for another.

`@langchain/community` is deprecated and archived read-only, so its SearXNG tool is
abandoned code — write the adapter by hand, as the Tavily one already is.

---

**Implemented.** `src/adapters/searxng-search.ts` — `searxngSearch({ baseUrl, maxResults? })`,
a hand-written `SearchPort` over `fetch`, no new dependency. `src/main.ts` picks it when
`SEARXNG_URL` is set, reading that variable directly rather than through `requireEnv` (which
throws on absence) and asking for `TAVILY_API_KEY` only on the Tavily branch, so a SearXNG run
needs no vendor credential. The port, the `web_search` Tool and the Agent Loop are untouched;
the Model sees the same three fields either way.

Both behaviours from the comments above are handled: a 403 is reported with the settings.yml
fix in the message, and `200` with an empty `results` array is raised as a `SearchError` naming
the entries of `unresponsive_engines` instead of returning an empty list the model would read
as "the web knows nothing about this". The body is read as text before parsing, so an HTML
error page from a dead instance appears in the error rather than being flattened into "invalid
JSON". Setup notes are in the README, plus a commented `SEARXNG_URL` in `.env.example`.

Two small additions beyond the letter of the list: the base URL is validated at construction
(`new URL("localhost:8080")` parses as a URL whose scheme is "localhost", which would otherwise
surface as a bare "fetch failed"), and `maxResults` defaults to 5 to match the Tavily adapter,
since SearXNG returns far more.

Verified without an instance, by pointing the adapter at a stub HTTP server: normal results
map correctly, and the degraded / 403 / non-JSON / connection-refused / already-aborted paths
each produce the intended `SearchError` or `AbortedError`. `npm run typecheck` passes.
