import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_TTL_DAYS } from './defaults';
import { SettingsStore } from './settings-store';
import type { SettingsPersistence } from './settings-store';

function fakePersistence(initial: unknown = undefined): SettingsPersistence & { saved: unknown[] } {
  const saved: unknown[] = [];
  return {
    saved,
    loadData: async () => initial,
    saveData: async (data) => {
      saved.push(data);
    },
  };
}

describe('SettingsStore', () => {
  it('starts from validated defaults when nothing is persisted', async () => {
    const store = await SettingsStore.load(fakePersistence());
    expect(store.settings.defaultTtlDays).toBe(DEFAULT_TTL_DAYS);
  });

  it('validates persisted data on the way in', async () => {
    const store = await SettingsStore.load(fakePersistence({ defaultTtlDays: 'soon' }));
    expect(store.settings.defaultTtlDays).toBe(DEFAULT_TTL_DAYS);
  });

  it('persists the whole settings object on update', async () => {
    const persistence = fakePersistence();
    const store = await SettingsStore.load(persistence);

    await store.update({ defaultTtlDays: 30 });

    expect(store.settings.defaultTtlDays).toBe(30);
    expect(persistence.saved).toEqual([store.settings]);
  });

  it('replaces the settings object rather than mutating it', async () => {
    const store = await SettingsStore.load(fakePersistence());
    const before = store.settings;

    await store.update({ defaultTtlDays: 30 });

    expect(store.settings).not.toBe(before);
    expect(before.defaultTtlDays).toBe(DEFAULT_TTL_DAYS);
  });

  it('notifies subscribers with the new settings', async () => {
    const store = await SettingsStore.load(fakePersistence());
    const listener = vi.fn();
    store.subscribe(listener);

    await store.update({ defaultTtlDays: 30 });

    expect(listener).toHaveBeenCalledWith(store.settings);
  });

  it('stops notifying once unsubscribed', async () => {
    const store = await SettingsStore.load(fakePersistence());
    const listener = vi.fn();
    store.subscribe(listener)();

    await store.update({ defaultTtlDays: 30 });

    expect(listener).not.toHaveBeenCalled();
  });
});
