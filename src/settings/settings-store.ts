import type { AutoRemoveSettings } from "../domain/types";
import { parseSettings } from "./settings-schema";

/**
 * The persistence surface this store needs. Obsidian's `Plugin` satisfies it
 * structurally, so nothing here has to import the Obsidian API.
 */
export interface SettingsPersistence {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

export type SettingsListener = (settings: AutoRemoveSettings) => void;

/**
 * Owns the current settings and notifies interested parties when they change.
 *
 * Settings are held as an immutable value: every update replaces the whole
 * object, so a cleanup run that captured a snapshot keeps working against
 * consistent configuration even if the user edits a rule mid-run.
 */
export class SettingsStore {
  private readonly listeners = new Set<SettingsListener>();

  private constructor(
    private readonly persistence: SettingsPersistence,
    private current: AutoRemoveSettings,
  ) {}

  static async load(persistence: SettingsPersistence): Promise<SettingsStore> {
    const settings = parseSettings(await persistence.loadData());
    return new SettingsStore(persistence, settings);
  }

  /** The current configuration. Treat the result as frozen. */
  get settings(): AutoRemoveSettings {
    return this.current;
  }

  /** Replaces the settings, persists them, and notifies listeners. */
  async update(changes: Partial<AutoRemoveSettings>): Promise<void> {
    this.current = { ...this.current, ...changes };
    await this.persistence.saveData(this.current);
    for (const listener of this.listeners) listener(this.current);
  }

  /** Subscribes to changes. Returns a function that unsubscribes. */
  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
