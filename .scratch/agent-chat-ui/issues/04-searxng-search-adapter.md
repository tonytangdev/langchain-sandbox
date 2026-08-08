# 04 — SearXNG as a keyless search adapter

**What to build:** A second implementation of the search port, backed by a locally-run
SearXNG instance, so web search works with no vendor API key.

With `SEARXNG_URL` set, `web_search` queries the local container. Without it, Tavily is
used exactly as today. Nothing about the Tool, the port, or the Agent Loop changes —
this is a new adapter beside the existing one, which is the first time the port
abstraction in this repo actually pays for itself.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] With `SEARXNG_URL` set, `npm run cli "<a current-events question>"` returns real
      results and no Tavily credential is read
- [ ] With `SEARXNG_URL` unset, Tavily is used and behaves as it does today
- [ ] A SearXNG instance that answers but returns no results surfaces as a visible
      search error naming the unresponsive engines, not as an empty success
- [ ] An unreachable or non-JSON SearXNG instance surfaces as a visible search error
- [ ] The search tool's output shape is unchanged, so the Model sees the same thing
      from either adapter
- [ ] Setup notes record that SearXNG's JSON output must be enabled in its settings
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
