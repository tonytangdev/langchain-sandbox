/**
 * The failures the domain knows how to talk about.
 *
 * LangChain throws its own error types, and the provider throws HTTP-shaped ones. Neither
 * reaches the Agent Loop: each adapter is responsible for catching whatever its vendor threw
 * and re-deriving one of these by hand. That hand-derivation is the price of ADR 0001 —
 * without a runtime carrying a typed error channel, the boundary has to do it itself.
 *
 * None of these are retried. While learning, a transient failure is more useful visible than
 * smoothed over.
 */

/** Base class, so a caller can catch everything the hexagon raises on purpose. */
export class AgentError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The Model could not be reached, or answered with something unusable. */
export class ModelError extends AgentError {}

/** The search Provider could not be reached, or answered with something unusable. */
export class SearchError extends AgentError {}

/**
 * The run's AbortSignal fired mid-flight.
 *
 * The domain cannot know *why* it fired — only the composition root knows whether it was the
 * deadline or something else — so this deliberately says no more than "we were cancelled".
 */
export class AbortedError extends AgentError {}

/** The model asked for a tool that was never offered to it. */
export class UnknownToolError extends AgentError {
  constructor(
    readonly toolName: string,
    available: readonly string[],
  ) {
    super(`The model asked for a tool that does not exist: "${toolName}". Available: ${available.join(", ")}.`);
  }
}
