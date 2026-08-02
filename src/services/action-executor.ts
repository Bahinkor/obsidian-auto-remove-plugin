import type { ExpiredFile } from "../domain/types";
import { executeAction } from "./pending-actions";
import type { PendingActions } from "./pending-actions";
import type { ActionFailure, CleanupResult, FileActions, OpenFileTracker } from "./ports";

/**
 * Carries out a confirmed set of removals and reports what happened.
 *
 * Actions run one at a time. Vault mutations are cheap but not free, and a
 * serial loop keeps the failure story simple: one file failing never leaves the
 * rest in an indeterminate state, and the summary the user sees is accurate.
 */
export class ActionExecutor {
  constructor(
    private readonly actions: FileActions,
    private readonly openFiles: OpenFileTracker,
    private readonly pending: PendingActions,
  ) {}

  async execute(items: readonly ExpiredFile[]): Promise<CleanupResult> {
    const removed: ExpiredFile[] = [];
    const deferred: ExpiredFile[] = [];
    const failed: ActionFailure[] = [];

    // Read the open set once: opening a tab midway through a run should not
    // change how the remaining files in that run are treated.
    const openPaths = this.openFiles.getOpenPaths();

    for (const item of items) {
      if (openPaths.has(item.file.path)) {
        this.pending.defer(item);
        deferred.push(item);
        continue;
      }

      try {
        await executeAction(this.actions, item);
        removed.push(item);
      } catch (error) {
        failed.push({ item, error });
      }
    }

    return { removed, deferred, failed };
  }
}
