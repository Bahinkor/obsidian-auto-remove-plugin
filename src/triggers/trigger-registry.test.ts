import { describe, expect, it, vi } from "vitest";
import { SettingsStore } from "../settings/settings-store";
import type { SettingsPersistence } from "../settings/settings-store";
import { TriggerRegistry } from "./trigger-registry";
import type { TriggerFactory } from "./trigger-registry";
import type { CleanupTrigger } from "./trigger";
import type { TriggerId } from "../domain/types";

function persistence(initial: unknown = undefined): SettingsPersistence {
  return { loadData: async () => initial, saveData: async () => {} };
}

/** A trigger that records how many times it was started and stopped. */
function spyTrigger(id: TriggerId) {
  const stop = vi.fn();
  const start = vi.fn(() => stop);
  const factory: TriggerFactory = () => ({ id, start }) satisfies CleanupTrigger;
  return { factory, start, stop };
}

describe("TriggerRegistry", () => {
  it("starts the triggers named in settings", async () => {
    const store = await SettingsStore.load(persistence({ triggers: ["startup"] }));
    const startup = spyTrigger("startup");
    const registry = new TriggerRegistry(store, new Map([["startup", startup.factory]]));

    registry.start();

    expect(startup.start).toHaveBeenCalledOnce();
    expect(registry.activeTriggers).toEqual(["startup"]);
  });

  it("starts nothing in manual-only mode", async () => {
    const store = await SettingsStore.load(persistence({ triggers: [] }));
    const startup = spyTrigger("startup");
    const registry = new TriggerRegistry(store, new Map([["startup", startup.factory]]));

    registry.start();

    expect(startup.start).not.toHaveBeenCalled();
    expect(registry.activeTriggers).toEqual([]);
  });

  it("detaches a trigger when the user turns it off", async () => {
    const store = await SettingsStore.load(persistence({ triggers: ["startup"] }));
    const startup = spyTrigger("startup");
    const registry = new TriggerRegistry(store, new Map([["startup", startup.factory]]));
    registry.start();

    await store.update({ triggers: [] });

    expect(startup.stop).toHaveBeenCalledOnce();
    expect(registry.activeTriggers).toEqual([]);
  });

  it("attaches a trigger when the user turns it on", async () => {
    const store = await SettingsStore.load(persistence({ triggers: [] }));
    const startup = spyTrigger("startup");
    const registry = new TriggerRegistry(store, new Map([["startup", startup.factory]]));
    registry.start();

    await store.update({ triggers: ["startup"] });

    expect(startup.start).toHaveBeenCalledOnce();
  });

  it("leaves an already-running trigger alone on an unrelated change", async () => {
    const store = await SettingsStore.load(persistence({ triggers: ["startup"] }));
    const startup = spyTrigger("startup");
    const registry = new TriggerRegistry(store, new Map([["startup", startup.factory]]));
    registry.start();

    await store.update({ defaultTtlDays: 30 });

    expect(startup.start).toHaveBeenCalledOnce();
    expect(startup.stop).not.toHaveBeenCalled();
  });

  it("ignores a configured trigger it has no factory for", async () => {
    const store = await SettingsStore.load(persistence({ triggers: ["startup"] }));
    const registry = new TriggerRegistry(store, new Map());

    expect(() => registry.start()).not.toThrow();
    expect(registry.activeTriggers).toEqual([]);
  });

  it("stops everything and stops following settings on shutdown", async () => {
    const store = await SettingsStore.load(persistence({ triggers: ["startup"] }));
    const startup = spyTrigger("startup");
    const registry = new TriggerRegistry(store, new Map([["startup", startup.factory]]));
    registry.start();

    registry.stop();
    await store.update({ triggers: ["startup"] });

    expect(startup.stop).toHaveBeenCalledOnce();
    expect(startup.start).toHaveBeenCalledOnce();
    expect(registry.activeTriggers).toEqual([]);
  });
});
