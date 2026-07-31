import type { TriggerId } from '../domain/types';

/**
 * Something that starts a cleanup run on its own.
 *
 * Triggers are deliberately minimal: they decide *when*, never *what*. All of
 * them funnel into the same `CleanupService.run`, so a new trigger cannot
 * accidentally introduce a second, subtly different cleanup path.
 *
 * The manual command is not a trigger — it is always available regardless of
 * configuration, and lives with the other commands.
 */
export interface CleanupTrigger {
  readonly id: TriggerId;
  /** Begins listening. Returns a function that stops it again. */
  start(): () => void;
}

/** Starts a cleanup run. Supplied to triggers so they never build one. */
export type RunCleanup = () => void;
