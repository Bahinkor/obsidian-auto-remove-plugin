import type { Workspace } from "obsidian";
import type { CleanupTrigger, RunCleanup } from "./trigger";

/**
 * Runs a cleanup once the workspace has finished loading.
 *
 * `onLayoutReady` matters for more than politeness: until layout is ready the
 * workspace cannot say which files are open, and a scan that ran before then
 * would happily offer to delete the note the user is looking at.
 */
export class StartupTrigger implements CleanupTrigger {
  readonly id = "startup";

  constructor(
    private readonly workspace: Workspace,
    private readonly run: RunCleanup,
  ) {}

  start(): () => void {
    let cancelled = false;

    this.workspace.onLayoutReady(() => {
      // The user may have switched to manual-only while layout was settling.
      if (!cancelled) this.run();
    });

    return () => {
      cancelled = true;
    };
  }
}
