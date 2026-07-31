import type { AutoRemoveSettings, FolderRule } from '../domain/types';

/**
 * The TTL applied to a note that opts in without naming one.
 * Specified as seven days; kept here so the number appears exactly once.
 */
export const DEFAULT_TTL_DAYS = 7;

/** Bumped whenever the persisted shape changes; drives migrations on load. */
export const CURRENT_SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS: AutoRemoveSettings = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  defaultTtlDays: DEFAULT_TTL_DAYS,
  defaultAction: 'trash',
  defaultMoveDestination: '',
  folderRules: [],
  triggers: ['startup'],
};

/** A blank folder rule for the settings UI to hand to the user. */
export function createFolderRule(): FolderRule {
  return {
    id: createRuleId(),
    enabled: true,
    folder: '',
    ttlDays: DEFAULT_TTL_DAYS,
    action: 'trash',
    moveDestination: '',
    ignorePatterns: [],
  };
}

/**
 * A rule identity that survives reordering and editing.
 *
 * `crypto.randomUUID` is unavailable on insecure origins in some Obsidian
 * builds, so fall back to a timestamped random string rather than risk a throw
 * while the user is adding a rule.
 */
function createRuleId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
