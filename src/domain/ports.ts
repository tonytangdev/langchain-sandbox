/**
 * The two ports. Everything outside the hexagon reaches the Agent Loop through one of these,
 * and the loop knows nothing else about the world.
 */
import type { Message, Tool, Turn } from "./types.js";

export type ModelOptions = {
  /**
   * Called with each token as it arrives, if the implementation streams.
   *
   * Streaming is kept out of the return type on purpose. The domain's question is *what did
   * the model decide*, which is one Turn; tokens are a presentation concern that happens to
   * travel over the same connection. Keeping them in a callback means a fake ModelPort is
   * "ignore the callback, return a Turn" rather than an async iterable to assemble.
   */
  readonly onToken?: (token: string) => void;
  /** Threaded all the way into the underlying HTTP request, so aborting really stops work. */
  readonly signal?: AbortSignal;
};

/** The Model, reachable without knowing which Provider or client library is behind it. */
export type ModelPort = {
  /**
   * Send the conversation so far, with the tools the model may ask for, and get back the one
   * Turn it produced.
   *
   * @throws {ModelError} if the model could not be reached or answered unusably.
   * @throws {AbortedError} if `options.signal` fired mid-flight.
   */
  readonly respond: (
    messages: readonly Message[],
    tools: readonly Tool[],
    options?: ModelOptions,
  ) => Promise<Turn>;
};

export type SearchResult = {
  readonly title: string;
  readonly url: string;
  readonly content: string;
};

/** Web search, reachable without knowing which search Provider is behind it. */
export type SearchPort = {
  /** @throws {SearchError} if the provider could not be reached or answered unusably. */
  readonly search: (query: string, signal?: AbortSignal) => Promise<readonly SearchResult[]>;
};
