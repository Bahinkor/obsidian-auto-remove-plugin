import type { Plugin } from 'obsidian';
import type { CleanupService } from './services/cleanup-service';
import { reportOutcome } from './ui/notifications';

/**
 * Registers the commands Auto Remove contributes.
 *
 * The manual command is always available, whatever the trigger setting says:
 * "manual command only" is a statement about automatic runs, not a reason to
 * take the command away. No default hotkey is assigned, per plugin guidelines.
 */
export function registerCommands(plugin: Plugin, cleanup: CleanupService): void {
  plugin.addCommand({
    id: 'run-cleanup',
    name: 'Run cleanup',
    callback: async () => {
      reportOutcome(await cleanup.run(), true);
    },
  });
}
