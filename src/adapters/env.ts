/**
 * Credentials come from the environment and are never written into source. `.env` is
 * gitignored; `.env.example` is committed so the required keys are knowable before the first
 * run. Node's built-in `--env-file` loads it, so there is no `dotenv` dependency.
 */
import { AgentError } from "../domain/errors.js";

export class MissingCredentialError extends AgentError {
  constructor(name: string) {
    super(
      `${name} is not set. Copy .env.example to .env and fill it in, then run again — ` +
        `the program loads it with node's --env-file.`,
    );
  }
}

/**
 * Read a required variable, failing here rather than letting an empty key travel to the
 * provider and come back as an authentication error that looks like a bug.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new MissingCredentialError(name);
  return value;
}
