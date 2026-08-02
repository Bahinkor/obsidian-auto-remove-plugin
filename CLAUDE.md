# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Auto Remove** — an Obsidian community plugin that expires vault files by a time-to-live and then trashes or moves them. `README.md` documents the user-facing behaviour; `docs/ARCHITECTURE.md` documents the design and the reasoning behind each decision. Read the latter before changing anything structural.

## Commands

```bash
pnpm run dev          # esbuild watch → main.js (what you leave running while developing)
pnpm run build        # tsc --noEmit --skipLibCheck, then a minified production bundle
pnpm test             # vitest run
pnpm run test:watch   # vitest in watch mode
pnpm run lint         # eslint, including eslint-plugin-obsidianmd
```

Run a single test file or a single case:

```bash
pnpx vitest run src/domain/policy/policy.test.ts
pnpx vitest run -t "lets an explicit opt-out veto the folder rule covering it"
```

Note that `pnpm run build` type-checks *and* bundles; `pnpx tsc --noEmit --skipLibCheck` alone is the faster loop when you only want types.

To try the plugin in a real vault, symlink or copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/auto-remove/`. `main.js` is gitignored — it is a build artifact attached to releases, never committed.

## The one invariant that matters

`src/domain`, `src/services` and `src/settings` **must not import from `obsidian`.**

This is what makes the logic testable: there is no way to construct a `TFile` outside a running vault, so anything that touches the Obsidian API is untestable by definition. The boundary is enforced twice — a `no-restricted-imports` rule in `eslint.config.mjs`, and `src/architecture.test.ts`, which reads the source files and fails if an import slips through. If you find yourself wanting an Obsidian type in those directories, add a port to `src/services/ports.ts` instead and implement it in `src/adapters`.

Layering, each depending only inward:

```
ui/  triggers/  adapters/     ← the only code that imports `obsidian`
            ↓
        services/              ← workflows, over four ports
            ↓
  domain/         settings/    ← rules, types, configuration
```

`src/main.ts` is a composition root and nothing else — it wires by hand, with no DI container, no event bus and no generic repository.

## Non-obvious design points

**A policy source returns one of three verdicts, not "policy or null."** `PolicyVerdict` is `expire` / `exempt` / `abstain` (`src/domain/policy/policy-source.ts`). Collapsing `exempt` and `abstain` into `null` is the natural simplification and it is wrong: a note marked `auto-remove: false` would abstain and then be claimed by whatever folder rule it sits under, defeating the only mechanism for exempting a single note from a folder rule. Conversely a stray `ttl:` with no `auto-remove` genuinely *does* abstain — the value is ignored but the note never refused, so a folder rule may still claim it on the folder's terms. Both cases are pinned by tests in `src/domain/policy/policy.test.ts`; do not "simplify" them away.

**Priority order lives in one array.** `createPolicyResolver` (`src/domain/policy/resolver-factory.ts`) builds the ordered `PolicySource[]`. That order *is* the spec: frontmatter, then folder rules. Ignore patterns are evaluated inside `FolderRulePolicySource`, which is why an explicit `auto-remove: true` beats a folder's ignore patterns.

**The resolver is rebuilt per cleanup run from a settings snapshot.** Ignore matchers compile once, at construction. There is deliberately no cache to invalidate — a run sees one consistent configuration and edits take effect on the next run.

**Pending actions store paths, not decisions** (`src/services/pending-actions.ts`). When a file leaves the open set it is re-scanned against the current clock. "Edit to cancel, close to confirm" falls out of that single re-check; do not add separate edit tracking. The queue is in-memory only, so nothing survives a reload.

**Preview is a `PreviewGate` function** the cleanup service awaits, not a hard-wired step. Returning `null` cancels. Keeping it a parameter is what makes "nothing is removed without confirmation" a property of one signature.

## Obsidian API constraints

These were established by reading the API docs and the bundled `obsidian.d.ts`; getting them wrong is silent rather than loud.

- **`manifest.json` sets `minAppVersion: 1.6.6`**, which is the true floor of the APIs used (`FileManager.trashFile`, `AbstractInputSuggest.selectSuggestion`). Using anything newer requires bumping it and adding a `versions.json` entry.
- **Never read `leaf.view.file` to find open files.** Since Obsidian 1.7.2 a background tab holds a `DeferredView`, so the view object is absent for exactly the tabs that matter. Use `leaf.getViewState().state.file` (see `src/adapters/workspace-open-files.ts`) and do not call `loadIfDeferred()`, which undoes Obsidian's optimisation.
- **Deletion always goes through `FileManager.trashFile`**, which honours the user's own "Deleted files" preference. The plugin must never implement its own trash.
- **Moves use `FileManager.renameFile`**, not `Vault.rename`, so inbound links are updated per user preference. `renameFile` mutates the `TFile` in place, so the same reference stays valid afterwards.
- **Frontmatter is read from `MetadataCache`, never by parsing files.** A full scan therefore does zero disk I/O, which is what keeps startup scans imperceptible.
- **Frontmatter edits go through `FileManager.processFrontMatter`**, which throws on malformed YAML — that is caught and reported, and never rolls back an already-successful move.

## Deliberate deviations

`src/ui/settings-tab.ts` uses the imperative `display()` API rather than the declarative `getSettingDefinitions()` added in Obsidian 1.13.0. The declarative API binds one control to one settings key and cannot express a user-editable list of folder rules; adopting it would also raise `minAppVersion` to 1.13.0. The relevant lint rules are disabled for that one file in `eslint.config.mjs`, with the reason recorded there. `eslint-plugin-obsidianmd` forbids inline `eslint-disable` for these, so config-scoped overrides are the only route.

## Where to add things

| To add | Touch |
| --- | --- |
| A new way to claim (or exempt) files | One `PolicySource` in `src/domain/policy/`, one entry in `resolver-factory.ts` |
| A new automatic trigger | One `CleanupTrigger` in `src/triggers/`, one entry in `main.ts`, a new id in `TriggerId` |
| A new action | The `RemovalAction` union, `removal-action.ts`, `executeAction` in `pending-actions.ts`, `adapters/vault-file-actions.ts` |
| A new setting | `domain/types.ts`, `settings/defaults.ts`, `settings/settings-schema.ts`, `ui/settings-tab.ts` |
| Preview appearance | `ui/preview-modal.ts`, `ui/tree-view.ts` — the tree's *shape* is `domain/file-tree.ts` |

Settings arriving from `data.json` are user-editable, sync-merged and possibly written by an older version, so everything is validated once in `settings/settings-schema.ts`. Add validation there rather than defending downstream.

## Conventions

- Tests sit beside their subject as `*.test.ts`; esbuild only follows imports from `src/main.ts`, so they are never bundled.
- Source files are kept under roughly 200 lines. Split by responsibility when one grows past that.
- UI strings use sentence case (Obsidian's convention, lint-enforced). Only failures go to `console.error` — no routine logging.
- Styling uses Obsidian CSS variables in `styles.css` so the plugin follows the user's theme; no hardcoded colours or inline styles.
