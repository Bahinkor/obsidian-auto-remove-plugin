import { PluginSettingTab, Setting } from "obsidian";
import type { App, Plugin } from "obsidian";
import type { FolderRule, TriggerId } from "../domain/types";
import { createFolderRule, DEFAULT_TTL_DAYS } from "../settings/defaults";
import type { SettingsStore } from "../settings/settings-store";
import { FolderRuleEditor } from "./folder-rule-editor";
import { FolderSuggest } from "./folder-suggest";
import { pluralize } from "./format";

/** Trigger choices, as a dropdown until there is more than one to combine. */
const TRIGGER_OPTIONS: Record<string, string> = {
  startup: "On Obsidian startup",
  manual: "Manual command only",
};

/**
 * The Auto Remove settings page.
 *
 * Editing a rule re-renders the whole tab. The page is small, rules are few,
 * and a full redraw is what keeps conditional fields — the destination folder
 * appearing only for Move — correct without any incremental update logic.
 *
 * This uses the imperative `display()` API rather than the declarative
 * `getSettingDefinitions()` introduced in Obsidian 1.13.0. The declarative API
 * maps settings keys to controls one-for-one, which cannot express a list of
 * folder rules the user adds to and removes from at will. Adopting it would
 * also raise the minimum app version from 1.6.6 to 1.13.0 for no gain to the
 * feature that needs it least.
 */
export class AutoRemoveSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    plugin: Plugin,
    private readonly store: SettingsStore,
  ) {
    super(app, plugin);
  }

  override display(): void {
    this.containerEl.empty();
    this.renderDefaults();
    this.renderTrigger();
    this.renderFolderRules();
  }

  private renderDefaults(): void {
    const { settings } = this.store;

    new Setting(this.containerEl)
      .setName("Notes that opt in")
      .setDesc(
        'These settings apply to notes containing "auto-remove: true". ' +
          "Folder rules never apply to them.",
      )
      .setHeading();

    new Setting(this.containerEl)
      .setName("Default time to live")
      .setDesc('Used when a note opts in without giving a "ttl" property.')
      .addText((text) => {
        text
          .setPlaceholder(String(DEFAULT_TTL_DAYS))
          .setValue(String(settings.defaultTtlDays))
          .onChange((value) => {
            const days = Number(value);
            if (Number.isInteger(days) && days >= 0)
              void this.store.update({ defaultTtlDays: days });
          });
        text.inputEl.type = "number";
        text.inputEl.min = "0";
      });

    new Setting(this.containerEl)
      .setName("Default action")
      .setDesc("What happens to an opted-in note once it expires.")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ trash: "Trash", move: "Move" })
          .setValue(settings.defaultAction)
          .onChange(async (value) => {
            await this.store.update({ defaultAction: value === "move" ? "move" : "trash" });
            this.display();
          }),
      );

    if (settings.defaultAction === "move") {
      new Setting(this.containerEl)
        .setName("Default destination folder")
        .setDesc("Opted-in notes are left alone until this is set.")
        .addSearch((search) => {
          search
            .setPlaceholder("Archive")
            .setValue(settings.defaultMoveDestination)
            .onChange((folder) => void this.store.update({ defaultMoveDestination: folder }));
          new FolderSuggest(
            this.app,
            search.inputEl,
            (folder) => void this.store.update({ defaultMoveDestination: folder }),
          );
        });
    }
  }

  private renderTrigger(): void {
    new Setting(this.containerEl).setName("Cleanup").setHeading();

    new Setting(this.containerEl)
      .setName("Run cleanup")
      .setDesc("A preview always appears before anything is removed.")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions(TRIGGER_OPTIONS)
          .setValue(this.store.settings.triggers.includes("startup") ? "startup" : "manual")
          .onChange((value) => {
            const triggers: TriggerId[] = value === "startup" ? ["startup"] : [];
            void this.store.update({ triggers });
          }),
      );
  }

  private renderFolderRules(): void {
    const { folderRules } = this.store.settings;

    new Setting(this.containerEl)
      .setName("Folder rules")
      .setDesc(
        folderRules.length === 0
          ? "Apply a time to live to every file in a folder, including attachments."
          : `${pluralize(folderRules.length, "rule")}. The most specific folder wins.`,
      )
      .setHeading()
      .addButton((button) =>
        button
          .setIcon("plus")
          .setButtonText("Add rule")
          .setCta()
          .onClick(async () => {
            await this.replaceRules([...folderRules, createFolderRule()]);
            this.display();
          }),
      );

    for (const rule of folderRules) {
      new FolderRuleEditor(this.containerEl, {
        app: this.app,
        rule,
        onChange: (changes) => void this.updateRule(rule.id, changes),
        onDelete: () => void this.deleteRule(rule.id),
      }).render();
    }
  }

  /**
   * Changing the action re-renders, because it decides whether the destination
   * field belongs on the page at all; other edits leave the DOM alone so the
   * user does not lose focus mid-keystroke.
   */
  private async updateRule(id: string, changes: Partial<FolderRule>): Promise<void> {
    await this.replaceRules(
      this.store.settings.folderRules.map((rule) =>
        rule.id === id ? { ...rule, ...changes } : rule,
      ),
    );
    if (changes.action !== undefined) this.display();
  }

  private async deleteRule(id: string): Promise<void> {
    await this.replaceRules(this.store.settings.folderRules.filter((rule) => rule.id !== id));
    this.display();
  }

  private async replaceRules(folderRules: readonly FolderRule[]): Promise<void> {
    await this.store.update({ folderRules });
  }
}
