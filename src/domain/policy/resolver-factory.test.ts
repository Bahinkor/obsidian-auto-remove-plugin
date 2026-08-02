import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../settings/defaults";
import { createPolicyResolver } from "./resolver-factory";
import type { AutoRemoveSettings, FileSnapshot, FolderRule } from "../types";

function settings(overrides: Partial<AutoRemoveSettings> = {}): AutoRemoveSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function rule(overrides: Partial<FolderRule> & Pick<FolderRule, "folder">): FolderRule {
  return {
    id: `rule-${overrides.folder}`,
    enabled: true,
    ttlDays: 30,
    action: "trash",
    moveDestination: "",
    ignorePatterns: [],
    ...overrides,
  };
}

function file(path: string, frontmatter: Record<string, unknown> | null = null): FileSnapshot {
  return { path, extension: "md", mtime: 0, frontmatter };
}

describe("createPolicyResolver", () => {
  it("wires frontmatter ahead of folder rules", () => {
    const resolver = createPolicyResolver(
      settings({ folderRules: [rule({ folder: "Inbox", ttlDays: 30 })] }),
    );

    expect(resolver.resolve(file("Inbox/a.md", { "auto-remove": true, ttl: 2 }))?.ttlDays).toBe(2);
    expect(resolver.resolve(file("Inbox/b.md"))?.ttlDays).toBe(30);
  });

  it("gives frontmatter notes the configured default action", () => {
    const resolver = createPolicyResolver(
      settings({ defaultAction: "move", defaultMoveDestination: "Archive" }),
    );

    expect(resolver.resolve(file("a.md", { "auto-remove": true }))?.action).toEqual({
      kind: "move",
      destination: "Archive",
    });
  });

  it("disables frontmatter opt-in when the default action is unusable", () => {
    // Move with no destination cannot run, so no file is claimed rather than
    // being claimed and then failing at execution time.
    const resolver = createPolicyResolver(
      settings({ defaultAction: "move", defaultMoveDestination: "" }),
    );

    expect(resolver.resolve(file("a.md", { "auto-remove": true }))).toBeNull();
  });

  it("drops folder rules that move without a destination", () => {
    const resolver = createPolicyResolver(
      settings({ folderRules: [rule({ folder: "Inbox", action: "move", moveDestination: "" })] }),
    );

    expect(resolver.resolve(file("Inbox/a.md"))).toBeNull();
  });

  it("keeps folder rules that move to a configured destination", () => {
    const resolver = createPolicyResolver(
      settings({
        folderRules: [rule({ folder: "Inbox", action: "move", moveDestination: "Archive" })],
      }),
    );

    expect(resolver.resolve(file("Inbox/a.md"))?.action).toEqual({
      kind: "move",
      destination: "Archive",
    });
  });

  it("claims nothing when nothing is configured", () => {
    const resolver = createPolicyResolver(settings());
    expect(resolver.resolve(file("a.md"))).toBeNull();
  });
});
