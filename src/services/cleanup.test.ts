import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPolicyResolver } from '../domain/policy/resolver-factory';
import { MILLISECONDS_PER_DAY } from '../domain/types';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { ActionExecutor } from './action-executor';
import { CleanupService } from './cleanup-service';
import type { PreviewGate } from './cleanup-service';
import { ExpirationScanner } from './expiration-scanner';
import { PendingActions } from './pending-actions';
import { FakeOpenFiles, FakeVault, FakeWatcher } from './test-doubles';
import type { AutoRemoveSettings, FolderRule } from '../domain/types';
import type { ActionFailure } from './ports';

const NOW = Date.UTC(2026, 5, 1);
const daysAgo = (days: number): number => NOW - days * MILLISECONDS_PER_DAY;

function rule(overrides: Partial<FolderRule> & Pick<FolderRule, 'folder'>): FolderRule {
  return {
    id: `rule-${overrides.folder}`,
    enabled: true,
    ttlDays: 30,
    action: 'trash',
    moveDestination: '',
    ignorePatterns: [],
    ...overrides,
  };
}

/** Assembles the real services around fake infrastructure. */
function harness(options: {
  vault: FakeVault;
  settings?: Partial<AutoRemoveSettings>;
  openFiles?: FakeOpenFiles;
  preview?: PreviewGate;
}) {
  const openFiles = options.openFiles ?? new FakeOpenFiles();
  const watcher = new FakeWatcher();
  const failures: ActionFailure[] = [];
  let now = NOW;

  let settings: AutoRemoveSettings = { ...DEFAULT_SETTINGS, ...options.settings };
  const createResolver = () => createPolicyResolver(settings);

  const scanner = new ExpirationScanner(options.vault, () => now);
  const pending = new PendingActions({
    scanner,
    actions: options.vault,
    openFiles,
    watcher,
    createResolver,
    onFailure: (failure) => failures.push(failure),
  });
  const executor = new ActionExecutor(options.vault, openFiles, pending);
  const service = new CleanupService({
    scanner,
    executor,
    openFiles,
    createResolver,
    preview: options.preview ?? (async (items) => items),
  });

  return {
    service,
    scanner,
    pending,
    openFiles,
    watcher,
    failures,
    createResolver,
    setNow: (value: number) => {
      now = value;
    },
    setSettings: (changes: Partial<AutoRemoveSettings>) => {
      settings = { ...settings, ...changes };
    },
  };
}

describe('ExpirationScanner', () => {
  it('finds only files past their TTL', () => {
    const vault = new FakeVault([
      { path: 'Inbox/old.md', mtime: daysAgo(40) },
      { path: 'Inbox/fresh.md', mtime: daysAgo(2) },
      { path: 'Elsewhere/old.md', mtime: daysAgo(40) },
    ]);
    const { scanner, createResolver } = harness({
      vault,
      settings: { folderRules: [rule({ folder: 'Inbox', ttlDays: 30 })] },
    });

    expect(scanner.scan(createResolver()).map((item) => item.file.path)).toEqual(['Inbox/old.md']);
  });

  it('returns results in a stable path order', () => {
    const vault = new FakeVault([
      { path: 'b.md', mtime: daysAgo(40) },
      { path: 'a.md', mtime: daysAgo(40) },
      { path: 'Sub/c.md', mtime: daysAgo(40) },
    ]);
    const { scanner, createResolver } = harness({
      vault,
      settings: { folderRules: [rule({ folder: '', ttlDays: 1 })] },
    });

    // Locale-aware ordering, so casing does not scatter otherwise adjacent paths.
    expect(scanner.scan(createResolver()).map((item) => item.file.path)).toEqual([
      'a.md',
      'b.md',
      'Sub/c.md',
    ]);
  });

  it('rescan reports null once a file is edited back within its TTL', () => {
    const vault = new FakeVault([{ path: 'note.md', mtime: daysAgo(40) }]);
    const { scanner, createResolver } = harness({
      vault,
      settings: { folderRules: [rule({ folder: '', ttlDays: 30 })] },
    });

    expect(scanner.rescan('note.md', createResolver())).not.toBeNull();
    vault.touch('note.md', NOW);
    expect(scanner.rescan('note.md', createResolver())).toBeNull();
  });

  it('rescan reports null for a file that no longer exists', () => {
    const { scanner, createResolver } = harness({ vault: new FakeVault() });
    expect(scanner.rescan('gone.md', createResolver())).toBeNull();
  });
});

describe('CleanupService', () => {
  let vault: FakeVault;

  beforeEach(() => {
    vault = new FakeVault([
      { path: 'Inbox/a.md', mtime: daysAgo(40) },
      { path: 'Inbox/b.md', mtime: daysAgo(40) },
      { path: 'Inbox/fresh.md', mtime: daysAgo(1) },
    ]);
  });

  const inboxRule = { folderRules: [rule({ folder: 'Inbox', ttlDays: 30 })] };

  it('reports when nothing has expired', async () => {
    const { service } = harness({ vault: new FakeVault(), settings: inboxRule });
    expect(await service.run()).toEqual({ status: 'nothing-expired' });
  });

  it('never acts without going through the preview gate first', async () => {
    const preview = vi.fn<PreviewGate>(async () => null);
    const { service } = harness({ vault, settings: inboxRule, preview });

    const outcome = await service.run();

    expect(preview).toHaveBeenCalledOnce();
    expect(outcome).toEqual({ status: 'cancelled' });
    expect(vault.trashed).toEqual([]);
    expect(vault.has('Inbox/a.md')).toBe(true);
  });

  it('treats an empty selection as a cancellation', async () => {
    const { service } = harness({ vault, settings: inboxRule, preview: async () => [] });
    expect(await service.run()).toEqual({ status: 'cancelled' });
    expect(vault.trashed).toEqual([]);
  });

  it('acts only on the files the user kept selected', async () => {
    const preview: PreviewGate = async (items) =>
      items.filter((item) => item.file.path === 'Inbox/a.md');
    const { service } = harness({ vault, settings: inboxRule, preview });

    const outcome = await service.run();

    expect(vault.trashed).toEqual(['Inbox/a.md']);
    expect(outcome.status === 'completed' && outcome.result.removed).toHaveLength(1);
  });

  it('shows the preview the set of currently open files', async () => {
    const openFiles = new FakeOpenFiles(['Inbox/a.md']);
    const preview = vi.fn<PreviewGate>(async () => null);
    await harness({ vault, settings: inboxRule, openFiles, preview }).service.run();

    const openPaths = preview.mock.calls[0]?.[1];
    expect(openPaths?.has('Inbox/a.md')).toBe(true);
  });

  it('moves files when the rule says move, and strips nothing else', async () => {
    const { service } = harness({
      vault,
      settings: {
        folderRules: [
          rule({ folder: 'Inbox', ttlDays: 30, action: 'move', moveDestination: 'Archive' }),
        ],
      },
    });

    await service.run();

    expect(vault.moved).toEqual([
      { from: 'Inbox/a.md', to: 'Archive/a.md' },
      { from: 'Inbox/b.md', to: 'Archive/b.md' },
    ]);
  });

  it('records failures without abandoning the remaining files', async () => {
    vault.failOn = (path) => path === 'Inbox/a.md';
    const { service } = harness({ vault, settings: inboxRule });

    const outcome = await service.run();

    expect(vault.trashed).toEqual(['Inbox/b.md']);
    expect(outcome.status === 'completed' && outcome.result.failed).toHaveLength(1);
    expect(outcome.status === 'completed' && outcome.result.removed).toHaveLength(1);
  });

  it('refuses to start a second run while one is in flight', async () => {
    let release = (): void => {};
    const preview: PreviewGate = async (items) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return items;
    };
    const { service } = harness({ vault, settings: inboxRule, preview });

    const first = service.run();
    const second = await service.run();
    release();
    await first;

    expect(second).toEqual({ status: 'already-running' });
  });

  it('can run again once the previous run finishes', async () => {
    const { service } = harness({ vault, settings: inboxRule });
    await service.run();
    expect((await service.run()).status).toBe('nothing-expired');
  });
});

describe('open files', () => {
  const inboxRule = { folderRules: [rule({ folder: 'Inbox', ttlDays: 30 })] };

  function openVault(): FakeVault {
    return new FakeVault([
      { path: 'Inbox/open.md', mtime: daysAgo(40) },
      { path: 'Inbox/closed.md', mtime: daysAgo(40) },
    ]);
  }

  it('leaves an open file untouched and queues it instead', async () => {
    const vault = openVault();
    const { service, pending } = harness({
      vault,
      settings: inboxRule,
      openFiles: new FakeOpenFiles(['Inbox/open.md']),
    });

    const outcome = await service.run();

    expect(vault.trashed).toEqual(['Inbox/closed.md']);
    expect(vault.has('Inbox/open.md')).toBe(true);
    expect(outcome.status === 'completed' && outcome.result.deferred).toHaveLength(1);
    expect(pending.pendingPaths).toEqual(['Inbox/open.md']);
  });

  it('acts as soon as the file is closed unmodified', async () => {
    const vault = openVault();
    const openFiles = new FakeOpenFiles(['Inbox/open.md']);
    const { service, pending } = harness({ vault, settings: inboxRule, openFiles });
    await service.run();

    await openFiles.close('Inbox/open.md');

    expect(vault.trashed).toContain('Inbox/open.md');
    expect(pending.pendingPaths).toEqual([]);
  });

  it('drops the queued action when the file was edited before closing', async () => {
    const vault = openVault();
    const openFiles = new FakeOpenFiles(['Inbox/open.md']);
    const { service, pending } = harness({ vault, settings: inboxRule, openFiles });
    await service.run();

    // The user typed something: the modification time moved, so the TTL restarts.
    vault.touch('Inbox/open.md', NOW);
    await openFiles.close('Inbox/open.md');

    expect(vault.trashed).not.toContain('Inbox/open.md');
    expect(vault.has('Inbox/open.md')).toBe(true);
    expect(pending.pendingPaths).toEqual([]);
  });

  it('drops the queued action when the rule no longer covers the file', async () => {
    const vault = openVault();
    const openFiles = new FakeOpenFiles(['Inbox/open.md']);
    const { service, pending, setSettings } = harness({ vault, settings: inboxRule, openFiles });
    await service.run();

    setSettings({ folderRules: [] });
    await openFiles.close('Inbox/open.md');

    expect(vault.has('Inbox/open.md')).toBe(true);
    expect(pending.pendingPaths).toEqual([]);
  });

  it('keeps waiting while the file is still open elsewhere', async () => {
    const vault = openVault();
    const openFiles = new FakeOpenFiles(['Inbox/open.md']);
    const { service, pending } = harness({ vault, settings: inboxRule, openFiles });
    await service.run();

    await openFiles.open_('Inbox/other.md');

    expect(vault.has('Inbox/open.md')).toBe(true);
    expect(pending.pendingPaths).toEqual(['Inbox/open.md']);
  });

  it('follows a queued file that gets renamed', async () => {
    const vault = openVault();
    const openFiles = new FakeOpenFiles(['Inbox/open.md']);
    const { service, pending, watcher } = harness({ vault, settings: inboxRule, openFiles });
    await service.run();

    vault.add({ path: 'Inbox/renamed.md', mtime: daysAgo(40) });
    watcher.emitRename('Inbox/open.md', 'Inbox/renamed.md');
    await openFiles.close('Inbox/open.md');

    expect(vault.trashed).toContain('Inbox/renamed.md');
    expect(pending.pendingPaths).toEqual([]);
  });

  it('forgets a queued file that the user deletes first', async () => {
    const vault = openVault();
    const openFiles = new FakeOpenFiles(['Inbox/open.md']);
    const { service, pending, watcher } = harness({ vault, settings: inboxRule, openFiles });
    await service.run();

    watcher.emitDelete('Inbox/open.md');
    await openFiles.close('Inbox/open.md');

    expect(pending.pendingPaths).toEqual([]);
  });

  it('reports a failure from a queued action instead of retrying it forever', async () => {
    const vault = openVault();
    const openFiles = new FakeOpenFiles(['Inbox/open.md']);
    const { service, pending, failures } = harness({ vault, settings: inboxRule, openFiles });
    await service.run();

    vault.failOn = (path) => path === 'Inbox/open.md';
    await openFiles.close('Inbox/open.md');

    expect(failures).toHaveLength(1);
    expect(pending.pendingPaths).toEqual([]);
  });

  it('stops responding to the workspace once disposed', async () => {
    const vault = openVault();
    const openFiles = new FakeOpenFiles(['Inbox/open.md']);
    const { service, pending } = harness({ vault, settings: inboxRule, openFiles });
    await service.run();

    pending.dispose();
    await openFiles.close('Inbox/open.md');

    expect(vault.has('Inbox/open.md')).toBe(true);
  });
});
