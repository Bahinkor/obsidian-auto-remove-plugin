import type { ExpiredFile, FileSnapshot, RemovalAction } from '../domain/types';

/**
 * The seams between the cleanup logic and the vault it acts on.
 *
 * Each of these is implemented once against the Obsidian API in `src/adapters`
 * and faked in tests. They exist because a test needs them, not for symmetry —
 * anything the services can do in pure code is done in pure code.
 */

/** Reads the vault as a flat list of snapshots. */
export interface FileRepository {
  listFiles(): FileSnapshot[];
  /** Re-reads one file, or returns `null` if it is gone. */
  getFile(path: string): FileSnapshot | null;
}

/** Carries out the removal actions. */
export interface FileActions {
  trash(path: string): Promise<void>;
  /**
   * Moves a file into `destination`, returning its new path. Implementations
   * resolve name collisions rather than overwriting.
   */
  move(path: string, destination: string): Promise<string>;
}

/** Reports which files are open in the workspace and when that changes. */
export interface OpenFileTracker {
  getOpenPaths(): ReadonlySet<string>;
  /** Subscribes to open-set changes; returns a function that unsubscribes. */
  subscribe(listener: () => void): () => void;
}

/** Notifies when files move or disappear underneath a queued action. */
export interface FileWatcher {
  onRenamed(listener: (fromPath: string, toPath: string) => void): () => void;
  onDeleted(listener: (path: string) => void): () => void;
}

/** The current time in milliseconds. Injected so TTLs are testable. */
export type Clock = () => number;

/** The outcome of acting on one expired file. */
export interface ActionFailure {
  readonly item: ExpiredFile;
  readonly error: unknown;
}

export interface CleanupResult {
  /** Files acted on during this run. */
  readonly removed: readonly ExpiredFile[];
  /** Files left alone because they are open; queued to run once closed. */
  readonly deferred: readonly ExpiredFile[];
  readonly failed: readonly ActionFailure[];
}

/** Describes an action for reporting purposes. */
export interface PlannedAction {
  readonly path: string;
  readonly action: RemovalAction;
}
