import { normalizePath, TFolder } from 'obsidian';
import type { App, TFile } from 'obsidian';
import { MANAGED_PROPERTIES } from '../domain/policy/frontmatter-policy-source';
import { basename, joinPath, splitExtension } from '../domain/vault-path';
import type { FileActions } from '../services/ports';
import { requireFile } from './vault-file-repository';

/**
 * Performs removals through Obsidian's own file manager.
 *
 * Both actions delegate rather than reimplement: `trashFile` already honours
 * whichever deletion behaviour the user configured, and `renameFile` already
 * rewrites inbound links according to their link preferences. Reproducing
 * either here would mean quietly disagreeing with the rest of the app.
 */
export class VaultFileActions implements FileActions {
  constructor(private readonly app: App) {}

  /**
   * Deletes according to the user's "Deleted files" preference — system trash,
   * the vault's `.trash` folder, or permanent deletion. Auto Remove has no
   * opinion of its own and keeps no trash of its own.
   */
  async trash(path: string): Promise<void> {
    await this.app.fileManager.trashFile(requireFile(this.app, path));
  }

  /**
   * Moves a file into `destination` and hands back its new path.
   *
   * Once the move succeeds the file is released from Auto Remove's control by
   * stripping the properties that opted it in — otherwise an archived note
   * would simply expire again from its new home.
   */
  async move(path: string, destination: string): Promise<string> {
    const file = requireFile(this.app, path);
    const folder = normalizePath(destination);

    await this.ensureFolderExists(folder);
    const target = this.availablePath(folder, file.name);

    // `renameFile` mutates the TFile in place, so `file` stays valid afterwards.
    await this.app.fileManager.renameFile(file, target);
    await this.releaseFromAutoRemove(file);

    return file.path;
  }

  /**
   * Removes the properties Auto Remove owns.
   *
   * A failure here is reported but not fatal: the move already happened, and
   * rolling it back would be a second, riskier mutation. Malformed YAML is the
   * usual cause, and that is worth surfacing rather than hiding.
   */
  private async releaseFromAutoRemove(file: TFile): Promise<void> {
    if (file.extension.toLowerCase() !== 'md') return;

    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      for (const property of MANAGED_PROPERTIES) delete frontmatter[property];
    });
  }

  /** Creates the destination folder, including any missing parents. */
  private async ensureFolderExists(folder: string): Promise<void> {
    if (folder.length === 0) return;
    if (this.app.vault.getFolderByPath(folder) instanceof TFolder) return;

    try {
      await this.app.vault.createFolder(folder);
    } catch (error) {
      // Concurrent runs, or a folder created between the check and the call.
      if (this.app.vault.getFolderByPath(folder) === null) throw error;
    }
  }

  /**
   * Finds a free name in the destination, appending ` 1`, ` 2`, … the way
   * Obsidian does elsewhere. Expiring a file must never overwrite an unrelated
   * one that happens to share its name.
   */
  private availablePath(folder: string, name: string): string {
    const direct = joinPath(folder, name);
    if (this.app.vault.getAbstractFileByPath(direct) === null) return direct;

    const { stem, suffix } = splitExtension(basename(name));
    for (let index = 1; ; index += 1) {
      const candidate = joinPath(folder, `${stem} ${index}${suffix}`);
      if (this.app.vault.getAbstractFileByPath(candidate) === null) return candidate;
    }
  }
}
