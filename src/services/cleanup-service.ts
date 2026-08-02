import type { PolicyResolver } from "../domain/policy/policy-resolver";
import type { ExpiredFile } from "../domain/types";
import type { ActionExecutor } from "./action-executor";
import type { ExpirationScanner } from "./expiration-scanner";
import type { CleanupResult, OpenFileTracker } from "./ports";

/**
 * Decides which expired files the user confirmed.
 *
 * Returning `null` cancels the run. Today this is always the preview dialog;
 * keeping it as a function is what lets preview become optional later without
 * the cleanup path itself changing shape.
 */
export type PreviewGate = (
  items: readonly ExpiredFile[],
  openPaths: ReadonlySet<string>,
) => Promise<readonly ExpiredFile[] | null>;

/** How a run ended, so callers can report it appropriately. */
export type CleanupOutcome =
  | { readonly status: "nothing-expired" }
  | { readonly status: "cancelled" }
  | { readonly status: "already-running" }
  | { readonly status: "completed"; readonly result: CleanupResult };

export interface CleanupServiceOptions {
  readonly scanner: ExpirationScanner;
  readonly executor: ActionExecutor;
  readonly openFiles: OpenFileTracker;
  /** Builds a resolver from the settings in force at the start of the run. */
  readonly createResolver: () => PolicyResolver;
  readonly preview: PreviewGate;
}

/**
 * One cleanup run, start to finish: scan, ask, act.
 *
 * This is the only entry point for removing files. Triggers and the command
 * palette both call `run`, so there is a single place where the order of
 * operations — and the guarantee that nothing happens without confirmation —
 * is expressed.
 */
export class CleanupService {
  private running = false;

  constructor(private readonly options: CleanupServiceOptions) {}

  /**
   * The startup trigger and the command can fire close together, and a second
   * run would show a preview listing files the first run is already deleting.
   */
  async run(): Promise<CleanupOutcome> {
    if (this.running) return { status: "already-running" };
    this.running = true;

    try {
      const expired = this.options.scanner.scan(this.options.createResolver());
      if (expired.length === 0) return { status: "nothing-expired" };

      const confirmed = await this.options.preview(expired, this.options.openFiles.getOpenPaths());
      if (confirmed === null || confirmed.length === 0) return { status: "cancelled" };

      return { status: "completed", result: await this.options.executor.execute(confirmed) };
    } finally {
      this.running = false;
    }
  }
}
