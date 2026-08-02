import { normalizeFolder } from "../domain/vault-path";
import type { AutoRemoveSettings, FolderRule, RemovalActionKind, TriggerId } from "../domain/types";
import { CURRENT_SCHEMA_VERSION, DEFAULT_SETTINGS, DEFAULT_TTL_DAYS } from "./defaults";

/**
 * Turns whatever is in `data.json` into settings the rest of the plugin can
 * trust.
 *
 * The file is plain JSON on disk: users edit it, sync clients merge it, and an
 * older version of the plugin may have written it. Validating once here means
 * no downstream code has to defend against a `ttlDays` of `"soon"`, and a
 * corrupt field costs the user one default rather than a broken plugin.
 */
export function parseSettings(raw: unknown): AutoRemoveSettings {
  const source = isRecord(raw) ? raw : {};

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    defaultTtlDays: parseTtl(source["defaultTtlDays"], DEFAULT_TTL_DAYS),
    defaultAction: parseActionKind(source["defaultAction"]),
    defaultMoveDestination: parseFolderPath(source["defaultMoveDestination"]),
    folderRules: parseFolderRules(source["folderRules"]),
    triggers: parseTriggers(source["triggers"]),
  };
}

/** Human-readable reason a rule cannot run, or `null` when it is usable. */
export function describeRuleProblem(rule: FolderRule): string | null {
  if (rule.action === "move" && normalizeFolder(rule.moveDestination).length === 0) {
    return "Choose a destination folder, or switch this rule to Trash.";
  }
  if (rule.action === "move" && wouldMoveIntoItself(rule)) {
    return "The destination folder is inside the rule folder, so files would expire again.";
  }
  return null;
}

/**
 * A destination nested inside the rule's own folder would re-expire everything
 * it receives, deleting files on the next run after appearing to archive them.
 */
function wouldMoveIntoItself(rule: FolderRule): boolean {
  const folder = normalizeFolder(rule.folder);
  const destination = normalizeFolder(rule.moveDestination);
  if (destination.length === 0) return false;
  if (folder.length === 0) return true;
  return destination === folder || destination.startsWith(`${folder}/`);
}

function parseFolderRules(raw: unknown): FolderRule[] {
  if (!Array.isArray(raw)) return [...DEFAULT_SETTINGS.folderRules];
  return raw.filter(isRecord).map(parseFolderRule);
}

function parseFolderRule(raw: Record<string, unknown>, index: number): FolderRule {
  return {
    id: typeof raw["id"] === "string" && raw["id"].length > 0 ? raw["id"] : `rule-${index}`,
    enabled: raw["enabled"] !== false,
    folder: parseFolderPath(raw["folder"]),
    ttlDays: parseTtl(raw["ttlDays"], DEFAULT_TTL_DAYS),
    action: parseActionKind(raw["action"]),
    moveDestination: parseFolderPath(raw["moveDestination"]),
    ignorePatterns: parsePatterns(raw["ignorePatterns"]),
  };
}

/** Accepts patterns as an array or as the newline-separated text the UI edits. */
function parsePatterns(raw: unknown): string[] {
  if (typeof raw === "string") return splitPatternLines(raw);
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === "string");
}

export function splitPatternLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseTtl(raw: unknown, fallback: number): number {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(value) || value < 0) return fallback;
  return value;
}

function parseActionKind(raw: unknown): RemovalActionKind {
  return raw === "move" ? "move" : "trash";
}

function parseFolderPath(raw: unknown): string {
  return typeof raw === "string" ? normalizeFolder(raw) : "";
}

const KNOWN_TRIGGERS: readonly TriggerId[] = ["startup"];

function parseTriggers(raw: unknown): TriggerId[] {
  if (!Array.isArray(raw)) return [...DEFAULT_SETTINGS.triggers];
  return KNOWN_TRIGGERS.filter((trigger) => raw.includes(trigger));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
