/**
 * The one piece of vendor-error handling both adapters share.
 *
 * ADR 0001 makes each adapter responsible for translating its own vendor's throws into the
 * domain's vocabulary, and that stays true — `ModelError` and `SearchError` are derived
 * separately, in their own files. But "were we aborted?" is not a per-vendor judgement: it is
 * the same question, and having each adapter answer it from memory is how the two answers
 * drifted apart in the first place.
 */

/**
 * Did this throw because the run was cancelled, rather than because something broke?
 *
 * Checking the signal first is what makes this reliable: vendors disagree about the name of
 * the error they raise on abort (`fetch` raises `AbortError`, the OpenAI client wraps it as
 * `APIUserAbortError`), and some wrap it in something else entirely. If we asked for the
 * abort, the cause hardly matters.
 */
export function isAbort(cause: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true;
  return cause instanceof Error && (cause.name === "AbortError" || cause.name === "APIUserAbortError");
}

/** Whatever the vendor put in front of a human, without assuming it was an `Error`. */
export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
