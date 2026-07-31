import type { AutoRemoveSettings, TriggerId } from '../domain/types';
import type { SettingsStore } from '../settings/settings-store';
import type { CleanupTrigger } from './trigger';

/** Builds a trigger on demand. Registering a new kind means adding one entry. */
export type TriggerFactory = () => CleanupTrigger;

/**
 * Keeps the running triggers in step with the settings.
 *
 * Triggers are torn down and rebuilt whenever the configuration changes, rather
 * than being asked to reconfigure themselves. That keeps each trigger a simple
 * start/stop object, and means turning one off genuinely detaches its listeners
 * instead of leaving a disabled one subscribed.
 */
export class TriggerRegistry {
  private readonly active = new Map<TriggerId, () => void>();
  private unsubscribeFromSettings: (() => void) | null = null;

  constructor(
    private readonly store: SettingsStore,
    private readonly factories: ReadonlyMap<TriggerId, TriggerFactory>,
  ) {}

  /** Starts the configured triggers and keeps following settings changes. */
  start(): void {
    this.unsubscribeFromSettings = this.store.subscribe((settings) => this.sync(settings));
    this.sync(this.store.settings);
  }

  /** The triggers currently listening, for diagnostics and tests. */
  get activeTriggers(): readonly TriggerId[] {
    return [...this.active.keys()];
  }

  stop(): void {
    this.unsubscribeFromSettings?.();
    this.unsubscribeFromSettings = null;
    for (const stop of this.active.values()) stop();
    this.active.clear();
  }

  private sync(settings: AutoRemoveSettings): void {
    const wanted = new Set(settings.triggers);

    for (const [id, stop] of this.active) {
      if (wanted.has(id)) continue;
      stop();
      this.active.delete(id);
    }

    for (const id of wanted) {
      if (this.active.has(id)) continue;
      const factory = this.factories.get(id);
      if (factory === undefined) continue;
      this.active.set(id, factory().start());
    }
  }
}
