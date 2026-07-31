import { parentFolder, joinPath, splitExtension } from '../domain/vault-path';
import type { FileSnapshot } from '../domain/types';
import type { FileActions, FileRepository, FileWatcher, OpenFileTracker } from './ports';

/**
 * In-memory stand-ins for the vault, used by the service tests.
 *
 * They are behavioural rather than mocks: the vault double really moves files
 * and really renames on collision, so a test failure means the logic is wrong
 * rather than an expectation being out of date.
 */

export interface FakeFile {
  path: string;
  mtime: number;
  frontmatter?: Record<string, unknown> | null;
}

export class FakeVault implements FileRepository, FileActions {
  readonly trashed: string[] = [];
  readonly moved: Array<{ from: string; to: string }> = [];
  failOn: ((path: string) => boolean) | null = null;

  private files = new Map<string, FileSnapshot>();

  constructor(files: FakeFile[] = []) {
    for (const file of files) this.add(file);
  }

  add(file: FakeFile): void {
    const { suffix } = splitExtension(file.path);
    this.files.set(file.path, {
      path: file.path,
      extension: suffix.replace(/^\./, ''),
      mtime: file.mtime,
      frontmatter: file.frontmatter ?? null,
    });
  }

  touch(path: string, mtime: number): void {
    const existing = this.files.get(path);
    if (existing === undefined) throw new Error(`No such file: ${path}`);
    this.files.set(path, { ...existing, mtime });
  }

  listFiles(): FileSnapshot[] {
    return [...this.files.values()];
  }

  getFile(path: string): FileSnapshot | null {
    return this.files.get(path) ?? null;
  }

  has(path: string): boolean {
    return this.files.has(path);
  }

  async trash(path: string): Promise<void> {
    this.assertUsable(path);
    this.files.delete(path);
    this.trashed.push(path);
  }

  async move(path: string, destination: string): Promise<string> {
    const existing = this.assertUsable(path);
    const target = this.availablePath(destination, path);

    this.files.delete(path);
    this.files.set(target, { ...existing, path: target });
    this.moved.push({ from: path, to: target });
    return target;
  }

  private availablePath(destination: string, sourcePath: string): string {
    const name = sourcePath.slice(parentFolder(sourcePath).length).replace(/^\//, '');
    const { stem, suffix } = splitExtension(name);

    let candidate = joinPath(destination, name);
    for (let index = 1; this.files.has(candidate); index += 1) {
      candidate = joinPath(destination, `${stem} ${index}${suffix}`);
    }
    return candidate;
  }

  private assertUsable(path: string): FileSnapshot {
    if (this.failOn?.(path) === true) throw new Error(`Simulated failure for ${path}`);
    const existing = this.files.get(path);
    if (existing === undefined) throw new Error(`No such file: ${path}`);
    return existing;
  }
}

export class FakeOpenFiles implements OpenFileTracker {
  private open = new Set<string>();
  private readonly listeners = new Set<() => void>();

  constructor(initiallyOpen: string[] = []) {
    this.open = new Set(initiallyOpen);
  }

  getOpenPaths(): ReadonlySet<string> {
    return this.open;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Simulates the user closing a tab, notifying subscribers as Obsidian would. */
  async close(path: string): Promise<void> {
    this.open.delete(path);
    await this.notify();
  }

  async open_(path: string): Promise<void> {
    this.open.add(path);
    await this.notify();
  }

  private async notify(): Promise<void> {
    for (const listener of this.listeners) listener();
    // Listeners kick off async work; yield so it settles before assertions.
    await Promise.resolve();
    await Promise.resolve();
  }
}

export class FakeWatcher implements FileWatcher {
  private readonly renameListeners = new Set<(from: string, to: string) => void>();
  private readonly deleteListeners = new Set<(path: string) => void>();

  onRenamed(listener: (from: string, to: string) => void): () => void {
    this.renameListeners.add(listener);
    return () => this.renameListeners.delete(listener);
  }

  onDeleted(listener: (path: string) => void): () => void {
    this.deleteListeners.add(listener);
    return () => this.deleteListeners.delete(listener);
  }

  emitRename(from: string, to: string): void {
    for (const listener of this.renameListeners) listener(from, to);
  }

  emitDelete(path: string): void {
    for (const listener of this.deleteListeners) listener(path);
  }
}
