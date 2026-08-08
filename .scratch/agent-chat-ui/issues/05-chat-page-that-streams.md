# 05 — A chat page that streams

**What to build:** A web app serving a chat interface: a transcript, a text box, and a
reply that streams in token by token.

The reply is hardcoded. No agent, no model, no tools. This ticket exists to prove the
streaming protocol end to end while there is exactly one thing that can be wrong —
the protocol's failure modes are silent (a missing opening chunk renders nothing at
all; an unresolved handler hangs the response forever), and debugging those alongside
a real agent loop is much harder than debugging them alone.

The CLI keeps working throughout.

**Blocked by:** None — can start immediately

**Status:** done

- [x] `npm run dev` serves a page with an empty transcript and a text box
- [x] Submitting a message shows it in the transcript and streams a hardcoded reply in
      progressively, not all at once
- [x] Reloading the page gives a fresh empty conversation
- [x] Replies render markdown, and render it sanely while still incomplete mid-stream
- [x] The transcript stays pinned to the bottom as content arrives, but does not fight
      a user who has scrolled up
- [x] The CLI still runs, and `npm run typecheck` covers both the app and the
      domain/CLI
- [x] The domain and CLI keep their existing strict compiler settings

## Comments

Next.js at the repo root, App Router. Two tsconfigs: the framework rewrites its own on
first run, and letting it own a single shared config would silently drop the strict
module settings the domain was deliberately given.

Requires Node 22+ and React 19. Pin the AI SDK and its React binding to exact
versions and keep them in lockstep — the React binding depends on an exact version of
the core package, so a drifting range puts two copies in the tree. Treat a major bump
as its own task with testing: the stream protocol has no formal specification and no
conformance suite, so this is coded against observed behaviour.

No Tailwind, no component library. Hand-rolled CSS plus two direct dependencies for
the two genuinely hard things — streaming-safe markdown, and pin-to-bottom autoscroll.
Vendoring twenty-odd component files into a repo whose identity is being small enough
to read cuts against the point of it.

Two protocol details that cost an afternoon each if missed: the opening chunk must be
emitted explicitly — nothing else creates the assistant message, and a stream of pure
text deltas renders nothing — and the stream closes when the handler's promise
settles, so it must settle on every path including error and abort.

---

Built. Next.js 16 App Router at the repo root: `app/layout.tsx`, `app/page.tsx`,
`app/chat.tsx` (the only client component), `app/globals.css`, `app/api/chat/route.ts`,
plus `next.config.ts`.

`ai@7.0.58` and `@ai-sdk/react@4.0.61` are pinned with `--save-exact`; the binding
declares a dependency on that exact `ai` version, so they move together or not at all.
Two other direct deps: `streamdown` (markdown that tolerates being half-written) and
`use-stick-to-bottom` (the autoscroll). No Tailwind — `app/globals.css` is hand-rolled.

`tsconfig.json` is the app's and `tsconfig.node.json` is the domain and CLI's, byte-for-byte
the old settings. The prediction in this ticket was right: Next rewrote `tsconfig.json`
on first `npm run dev` (flipped `jsx` to `react-jsx`, added `.next/dev/types`). It left
`tsconfig.node.json` alone. `typecheck` runs both, in that order.

The chunk protocol the route writes, per response: `start` → `text-start` →
n × `text-delta` → `text-end` → `finish`. The `start` chunk is what creates the
assistant message; the closing pair is written in a `finally`, and the per-delta sleep
aborts on `request.signal`, so the handler promise settles on completion, throw and
client disconnect alike.

Deviation, small: `StickToBottom.Content` injects its own scroll element between the
wrapper and the content, so the overflow lives on `scrollClassName` (`.transcript-scroll`)
rather than on the visible bordered box. Putting it on the box scrolls nothing and is
silent about it.

Verified in Chrome against `npm run dev`: assistant text grew 29 → 62 → 92 → … → 503
characters in ~30-character steps sampled every 150 ms, so it is genuinely progressive.
Reload gives an empty transcript. Left alone the transcript sits 1 px from the bottom
while content arrives; scrolled to the top mid-stream it stayed at `scrollTop` 0 while
the content grew 808 → 1085 px. No console errors, `POST /api/chat` 200.
