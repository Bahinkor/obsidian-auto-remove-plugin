import { Plugin } from "obsidian";
import { VaultFileActions } from "./adapters/vault-file-actions";
import { VaultFileRepository } from "./adapters/vault-file-repository";
import { WorkspaceOpenFileTracker } from "./adapters/workspace-open-files";
import { registerCommands } from "./commands";
import { createPolicyResolver } from "./domain/policy/resolver-factory";
import type { TriggerId } from "./domain/types";
import { ActionExecutor } from "./services/action-executor";
import { CleanupService } from "./services/cleanup-service";
import { ExpirationScanner } from "./services/expiration-scanner";
import { PendingActions } from "./services/pending-actions";
import { SettingsStore } from "./settings/settings-store";
import { StartupTrigger } from "./triggers/startup-trigger";
import { TriggerRegistry } from "./triggers/trigger-registry";
import type { TriggerFactory } from "./triggers/trigger-registry";
import { reportOutcome } from "./ui/notifications";
import { CleanupPreviewModal } from "./ui/preview-modal";
import { AutoRemoveSettingTab } from "./ui/settings-tab";

/**
 * Auto Remove — expires files by time to live, then trashes or moves them.
 *
 * This class is the composition root and nothing more. Every rule lives in
 * `src/domain`, every workflow in `src/services`, and every Obsidian call in
 * `src/adapters` and `src/ui`; the only job here is to connect them and to
 * tear them down again. See `docs/ARCHITECTURE.md`.
 */
export default class AutoRemovePlugin extends Plugin {
  private openFiles: WorkspaceOpenFileTracker | null = null;
  private pending: PendingActions | null = null;
  private triggers: TriggerRegistry | null = null;

  override async onload(): Promise<void> {
    const store = await SettingsStore.load(this);
    const createResolver = () => createPolicyResolver(store.settings);

    const openFiles = new WorkspaceOpenFileTracker(this.app);
    const actions = new VaultFileActions(this.app);
    const scanner = new ExpirationScanner(new VaultFileRepository(this.app), Date.now);

    const pending = new PendingActions({
      scanner,
      actions,
      openFiles,
      watcher: openFiles,
      createResolver,
      onFailure: ({ item, error }) =>
        console.error(`Auto Remove: could not remove "${item.file.path}"`, error),
    });

    const cleanup = new CleanupService({
      scanner,
      executor: new ActionExecutor(actions, openFiles, pending),
      openFiles,
      createResolver,
      // Preview is mandatory today. Making it optional later means choosing a
      // different gate here; no other code needs to know.
      preview: (items, openPaths) => CleanupPreviewModal.confirm(this.app, items, openPaths),
    });

    this.openFiles = openFiles;
    this.pending = pending;
    this.triggers = new TriggerRegistry(store, this.createTriggerFactories(cleanup));
    this.triggers.start();

    this.addSettingTab(new AutoRemoveSettingTab(this.app, this, store));
    registerCommands(this, cleanup);
  }

  /**
   * The catalogue of automatic triggers. Adding an interval or on-quit trigger
   * means writing the trigger and adding it here.
   */
  private createTriggerFactories(cleanup: CleanupService): Map<TriggerId, TriggerFactory> {
    return new Map<TriggerId, TriggerFactory>([
      [
        "startup",
        () =>
          new StartupTrigger(this.app.workspace, () => {
            void cleanup.run().then((outcome) => reportOutcome(outcome, false));
          }),
      ],
    ]);
  }

  /**
   * Commands, the settings tab and anything registered through `Plugin` are
   * cleaned up by Obsidian. These three hold their own subscriptions, so they
   * are released explicitly.
   */
  override onunload(): void {
    this.triggers?.stop();
    this.pending?.dispose();
    this.openFiles?.dispose();
  }
}
