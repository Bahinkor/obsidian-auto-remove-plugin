/**
 * Core vocabulary of the plugin.
 *
 * Everything here is plain data with no behaviour and no dependency on the
 * Obsidian API, so the rules that operate on it can be exercised in isolation.
 */

/** Milliseconds in a day, used for every TTL calculation. */
export const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * What happens to a file once it expires.
 *
 * Modelled as a discriminated union so that "move without a destination" is
 * unrepresentable. Settings persist a flatter shape and are validated into this
 * type at the boundary; see {@link ../settings/settings-store}.
 */
export type RemovalAction =
  | { readonly kind: 'trash' }
  | { readonly kind: 'move'; readonly destination: string };

export type RemovalActionKind = RemovalAction['kind'];

/** An immutable view of a vault file, sufficient to decide its fate. */
export interface FileSnapshot {
  /** Vault-relative path, e.g. `Inbox/ideas/note.md`. */
  readonly path: string;
  /** Lower-case extension without the dot, e.g. `md`. */
  readonly extension: string;
  /** Last modification time as a Unix timestamp in milliseconds. */
  readonly mtime: number;
  /** Parsed frontmatter, or `null` for files that cannot carry any. */
  readonly frontmatter: Readonly<Record<string, unknown>> | null;
}

/** Explains which rule claimed a file, so the preview can show its provenance. */
export type PolicyOrigin =
  | { readonly source: 'frontmatter' }
  | { readonly source: 'folder-rule'; readonly ruleId: string; readonly folder: string };

/** The decision a {@link PolicySource} reached about a file. */
export interface ExpirationPolicy {
  readonly ttlDays: number;
  readonly action: RemovalAction;
  readonly origin: PolicyOrigin;
}

/** A file that has outlived its TTL, paired with the policy that claimed it. */
export interface ExpiredFile {
  readonly file: FileSnapshot;
  readonly policy: ExpirationPolicy;
  /** When the file became eligible for removal. */
  readonly expiredAt: number;
  /** How long ago the file was last modified, at scan time. */
  readonly ageMs: number;
}

/** A user-defined rule that applies a TTL to everything under a folder. */
export interface FolderRule {
  /** Stable identity, so the settings UI can edit a list without index churn. */
  readonly id: string;
  readonly enabled: boolean;
  /** Vault-relative folder path. An empty string means the vault root. */
  readonly folder: string;
  readonly ttlDays: number;
  readonly action: RemovalActionKind;
  /** Only meaningful when {@link action} is `move`. */
  readonly moveDestination: string;
  /** Gitignore-style patterns, resolved relative to {@link folder}. */
  readonly ignorePatterns: readonly string[];
}

/** Identifies an automatic cleanup trigger. Manual runs are commands, not triggers. */
export type TriggerId = 'startup';

/** The persisted plugin configuration. */
export interface AutoRemoveSettings {
  /** Bumped whenever the persisted shape changes, to drive migrations. */
  readonly schemaVersion: number;
  /** TTL applied to `auto-remove: true` notes that omit `ttl`. */
  readonly defaultTtlDays: number;
  /** Action applied to every frontmatter-opted file. */
  readonly defaultAction: RemovalActionKind;
  /** Only meaningful when {@link defaultAction} is `move`. */
  readonly defaultMoveDestination: string;
  readonly folderRules: readonly FolderRule[];
  /** Automatic triggers that are currently enabled. */
  readonly triggers: readonly TriggerId[];
}
