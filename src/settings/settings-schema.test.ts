import { describe, expect, it } from 'vitest';
import { toRemovalAction } from '../domain/removal-action';
import { DEFAULT_SETTINGS, DEFAULT_TTL_DAYS } from './defaults';
import { describeRuleProblem, parseSettings, splitPatternLines } from './settings-schema';
import type { FolderRule } from '../domain/types';

function rule(overrides: Partial<FolderRule> = {}): FolderRule {
  return {
    id: 'rule-1',
    enabled: true,
    folder: 'Inbox',
    ttlDays: 7,
    action: 'trash',
    moveDestination: '',
    ignorePatterns: [],
    ...overrides,
  };
}

describe('parseSettings', () => {
  it('falls back to defaults for missing or malformed data', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings([])).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps values it recognises', () => {
    const parsed = parseSettings({
      defaultTtlDays: 21,
      defaultAction: 'move',
      defaultMoveDestination: '/Archive/',
      triggers: ['startup'],
    });

    expect(parsed.defaultTtlDays).toBe(21);
    expect(parsed.defaultAction).toBe('move');
    expect(parsed.defaultMoveDestination).toBe('Archive');
  });

  it('replaces an unusable TTL with the default rather than expiring early', () => {
    expect(parseSettings({ defaultTtlDays: -5 }).defaultTtlDays).toBe(DEFAULT_TTL_DAYS);
    expect(parseSettings({ defaultTtlDays: 'soon' }).defaultTtlDays).toBe(DEFAULT_TTL_DAYS);
    expect(parseSettings({ defaultTtlDays: 1.5 }).defaultTtlDays).toBe(DEFAULT_TTL_DAYS);
  });

  it('treats an unrecognised action as trash', () => {
    expect(parseSettings({ defaultAction: 'incinerate' }).defaultAction).toBe('trash');
  });

  it('discards unknown triggers', () => {
    expect(parseSettings({ triggers: ['startup', 'telepathy'] }).triggers).toEqual(['startup']);
    expect(parseSettings({ triggers: [] }).triggers).toEqual([]);
  });

  it('normalises folder rules and skips non-object entries', () => {
    const parsed = parseSettings({
      folderRules: [
        { id: 'a', folder: '/Inbox/', ttlDays: 3, action: 'move', moveDestination: 'Archive/' },
        'not a rule',
        null,
      ],
    });

    expect(parsed.folderRules).toEqual([
      {
        id: 'a',
        enabled: true,
        folder: 'Inbox',
        ttlDays: 3,
        action: 'move',
        moveDestination: 'Archive',
        ignorePatterns: [],
      },
    ]);
  });

  it('accepts ignore patterns as an array or as newline-separated text', () => {
    const fromArray = parseSettings({ folderRules: [{ ignorePatterns: ['*.pdf', 42] }] });
    expect(fromArray.folderRules[0]?.ignorePatterns).toEqual(['*.pdf']);

    const fromText = parseSettings({ folderRules: [{ ignorePatterns: '*.pdf\n\n  *.canvas  ' }] });
    expect(fromText.folderRules[0]?.ignorePatterns).toEqual(['*.pdf', '*.canvas']);
  });

  it('gives a rule an id when one is missing, so the UI can track it', () => {
    const parsed = parseSettings({ folderRules: [{ folder: 'Inbox' }] });
    expect(parsed.folderRules[0]?.id).toBeTruthy();
  });

  it('always stamps the current schema version', () => {
    expect(parseSettings({ schemaVersion: 0 }).schemaVersion).toBe(DEFAULT_SETTINGS.schemaVersion);
  });
});

describe('toRemovalAction', () => {
  it('resolves trash unconditionally', () => {
    expect(toRemovalAction('trash', '')).toEqual({ kind: 'trash' });
  });

  it('resolves move only when a destination is configured', () => {
    expect(toRemovalAction('move', 'Archive')).toEqual({ kind: 'move', destination: 'Archive' });
    expect(toRemovalAction('move', '/Archive/')).toEqual({ kind: 'move', destination: 'Archive' });
    expect(toRemovalAction('move', '')).toBeNull();
    expect(toRemovalAction('move', '  ')).toBeNull();
  });
});

describe('describeRuleProblem', () => {
  it('accepts a usable rule', () => {
    expect(describeRuleProblem(rule())).toBeNull();
    expect(describeRuleProblem(rule({ action: 'move', moveDestination: 'Archive' }))).toBeNull();
  });

  it('reports a move with no destination', () => {
    expect(describeRuleProblem(rule({ action: 'move' }))).toContain('destination');
  });

  it('reports a destination nested inside the rule folder, which would re-expire', () => {
    const nested = rule({ folder: 'Inbox', action: 'move', moveDestination: 'Inbox/Archive' });
    expect(describeRuleProblem(nested)).toContain('inside');

    const itself = rule({ folder: 'Inbox', action: 'move', moveDestination: 'Inbox' });
    expect(describeRuleProblem(itself)).toContain('inside');
  });

  it('reports any destination under a whole-vault rule', () => {
    const wholeVault = rule({ folder: '', action: 'move', moveDestination: 'Archive' });
    expect(describeRuleProblem(wholeVault)).toContain('inside');
  });

  it('accepts a sibling destination that only shares a prefix', () => {
    const sibling = rule({ folder: 'Inbox', action: 'move', moveDestination: 'Inbox-archive' });
    expect(describeRuleProblem(sibling)).toBeNull();
  });
});

describe('splitPatternLines', () => {
  it('trims and drops blank lines', () => {
    expect(splitPatternLines('*.pdf\n\n  Templates/**  \n')).toEqual(['*.pdf', 'Templates/**']);
  });
});
