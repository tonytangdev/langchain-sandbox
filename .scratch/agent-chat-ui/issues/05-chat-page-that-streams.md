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

**Status:** ready-for-agent

- [ ] `npm run dev` serves a page with an empty transcript and a text box
- [ ] Submitting a message shows it in the transcript and streams a hardcoded reply in
      progressively, not all at once
- [ ] Reloading the page gives a fresh empty conversation
- [ ] Replies render markdown, and render it sanely while still incomplete mid-stream
- [ ] The transcript stays pinned to the bottom as content arrives, but does not fight
      a user who has scrolled up
- [ ] The CLI still runs, and `npm run typecheck` covers both the app and the
      domain/CLI
- [ ] The domain and CLI keep their existing strict compiler settings

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
