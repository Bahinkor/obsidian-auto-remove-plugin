# Architecture

This document explains how Auto Remove is put together and, more usefully, why.
It is aimed at someone picking the codebase up cold and wanting to change
something without breaking a rule they did not know existed.

## The shape: a pure core behind a thin Obsidian shell

Four layers, each depending only inward:

```
     ui/    triggers/    adapters/     ← the only code that imports `obsidian`
                  ↓
              services/                ← workflows, over ports
                  ↓
      domain/           settings/      ← rules, types and configuration
```

`src/domain`, `src/services` and `src/settings` contain no reference to the
Obsidian API at all. That is enforced two ways: a `no-restricted-imports` rule
in `eslint.config.mjs`, and `src/architecture.test.ts`, which reads the source
files and fails if an import slips through.

### Why

Almost every tricky rule in this plugin is pure logic: TTL arithmetic, the
frontmatter-over-folder-rule priority order, gitignore semantics, tree building,
and deciding whether a file the user just closed is still expired. None of it
involves I/O, but all of it lives inside an app you cannot instantiate in a test
runner — there is no way to construct a `TFile` without a vault.

Pushing that logic out of Obsidian's reach is what makes it testable at all. The
181 unit tests in this repository run in about a second with no Obsidian, no
vault and no DOM, and they cover the behaviour that actually deletes people's
files.

The Obsidian surface that remains is small — `Vault`, `MetadataCache`,
`FileManager`, `Workspace`, `Modal`, `Setting` — so the adapter layer is thin
rather than a parallel abstraction that has to be maintained alongside the real
API.

### What is deliberately *not* abstracted

No dependency injection container, no event bus, no generic repository, no
plugin lifecycle framework. There are exactly four ports (`src/services/ports.ts`)
and they exist because a test needs a seam, not for symmetry. `src/main.ts` is a
composition root that wires everything by hand in about seventy lines, and that
is the whole of the wiring story.

## Layers

### `src/domain` — rules and types

Pure functions and small classes with no I/O.

| Module | Responsibility |
| --- | --- |
| `types.ts` | The vocabulary: `FileSnapshot`, `RemovalAction`, `ExpirationPolicy`, `ExpiredFile`, `FolderRule`, `AutoRemoveSettings` |
| `vault-path.ts` | Vault-relative path handling, in one place, with Obsidian's conventions baked in |
| `expiration.ts` | All TTL arithmetic, and the parsing of a `ttl` frontmatter value |
| `removal-action.ts` | Bridges the flat settings shape and the `RemovalAction` union |
| `ignore-matcher.ts` | Gitignore matching — the only module aware of the `ignore` package |
| `file-tree.ts` | Turns a flat list of expired files into the hierarchy the preview renders |
| `policy/` | The priority chain (see below) |

### `src/services` — workflows

| Module | Responsibility |
| --- | --- |
| `ports.ts` | The four seams: `FileRepository`, `FileActions`, `OpenFileTracker`, `FileWatcher` |
| `expiration-scanner.ts` | Vault → expired files, and the single-file re-check |
| `action-executor.ts` | Runs a confirmed batch, deferring open files, collecting failures |
| `pending-actions.ts` | Actions waiting for an editor tab to close |
| `cleanup-service.ts` | One run, start to finish: scan → preview → act |

### `src/adapters` — the Obsidian implementations

`vault-file-repository.ts`, `vault-file-actions.ts`, `workspace-open-files.ts`.
One implementation each, no cleverness.

### `src/ui`, `src/triggers`, `src/settings`

The preview modal and its tree, the settings page, the automatic triggers, and
settings persistence and validation.

## Key decisions

### 1. The policy chain is an ordered list, not a chain of conditionals

`PolicyResolver` (`domain/policy/policy-resolver.ts`) holds an array of
`PolicySource`s and returns the first decisive verdict. The array order *is* the
documented priority:

1. `FrontmatterPolicySource` — notes that opt in, or out, explicitly
2. `FolderRulePolicySource` — folder rules, narrowed by their ignore patterns

Teaching Auto Remove a new way to claim files — tags, a saved search, a per-file
override — means writing one `PolicySource` and adding one entry in
`domain/policy/resolver-factory.ts`. Nothing else changes, and the priority is
stated in exactly one place instead of being distributed across `if` branches.

### 2. A source has three answers, not two

```ts
type PolicyVerdict =
  | { kind: 'expire'; policy: ExpirationPolicy }
  | { kind: 'exempt' }    // leave this alone — stop asking
  | { kind: 'abstain' };  // no opinion — ask the next source
```

"No opinion" and "explicitly leave this alone" look identical from one source
but mean opposite things to the chain. Collapsing them into a single `null` is
the natural first design, and it is wrong: a note saying `auto-remove: false`
would abstain, and then be claimed by whatever folder rule it happened to sit
under. That makes the property useless exactly when someone reaches for it —
it is the only way to exempt one note from a folder rule.

The distinction matters in the other direction too. A stray `ttl:` with no
`auto-remove` *abstains*: the value is ignored, but the note never refused, so a
folder rule may still claim it on the folder's terms. Both cases are covered in
`domain/policy/policy.test.ts`, and both were found by running the real code
over a fixture vault rather than by reading it.

### 3. Ignore patterns narrow folder rules; they do not veto frontmatter

The specified priority is frontmatter → folder rule → ignore. Ignore patterns
are therefore evaluated *inside* `FolderRulePolicySource`, which means a note
carrying `auto-remove: true` inside an ignored folder still expires. An explicit
opt-in is the note author's own instruction, and it outranks a rule about the
folder it happens to sit in.

Within folder rules, being ignored by the winning (deepest) rule returns
`exempt` rather than falling through to a shallower rule — otherwise a
vault-wide rule would quietly reclaim everything a nested rule had just
excluded.

### 4. Actions are a union; settings are flat

```ts
type RemovalAction =
  | { kind: 'trash' }
  | { kind: 'move'; destination: string };
```

"Move with no destination" is unrepresentable in the core. Settings persist the
JSON-friendly `action` + `moveDestination` pair, and `toRemovalAction` converts
at the boundary, returning `null` when a move has nowhere to go. A rule in that
state is dropped from the resolver entirely, so it claims nothing rather than
claiming files it would then fail on.

### 5. The resolver is rebuilt per run from a settings snapshot

`createPolicyResolver(settings)` compiles the ignore matchers once and is called
at the start of each run. Cache invalidation therefore does not exist as a
problem: a run sees one consistent configuration, and an edit made mid-run takes
effect on the next one.

### 6. Open files are detected from view state, not from the view

Since Obsidian 1.7.2, a background tab holds a `DeferredView` instead of the
real view, so `leaf.view.file` is absent for exactly the tabs that matter most
here — the quiet background ones holding a file open. `WorkspaceOpenFileTracker`
reads `leaf.getViewState().state.file` instead, which is present either way and
avoids calling `loadIfDeferred()`, which would undo the optimisation Obsidian
just made. `iterateAllLeaves` covers the main area, both sidebars and pop-out
windows.

### 7. Pending actions are re-validated, never replayed

`PendingActions` stores paths, not decisions. When a file leaves the open set,
the scanner re-reads it and re-resolves its policy against the current clock:

- edited before closing → no longer expired → the action is dropped;
- closed untouched → still expired → the action runs.

That single re-check implements both halves of the rule without tracking edits
separately. The queue is in-memory only; nothing survives a restart, so a stale
decision can never outlive the session that made it, and the next startup scan
rediscovers whatever is still expired.

### 8. Preview is a gate function, not a hard-wired step

`CleanupService` takes a `PreviewGate`:

```ts
type PreviewGate = (
  items: readonly ExpiredFile[],
  openPaths: ReadonlySet<string>,
) => Promise<readonly ExpiredFile[] | null>;
```

Today `main.ts` always passes the modal, and returning `null` cancels. Making
preview optional later means choosing a different gate at the composition root;
the cleanup path itself does not change shape. It also makes "nothing is removed
without confirmation" a property of one function signature rather than a
convention spread across callers.

### 9. Triggers are strategies behind a registry

`TriggerRegistry` starts and stops triggers to match `settings.triggers`, and
re-syncs whenever settings change, so turning one off genuinely detaches its
listeners. Settings store an *array* of trigger ids even though the UI currently
offers a two-option dropdown, so adding an interval or on-quit trigger needs a
new `CleanupTrigger`, one entry in `main.ts`, and no schema migration.

The manual command is not a trigger. "Manual command only" is a statement about
automatic runs, not a reason to take the command away, so it is registered
unconditionally in `src/commands.ts`.

### 10. Scanning does no I/O

`vault.getFiles()` is an in-memory list and `MetadataCache` already holds parsed
frontmatter, so a full scan touches the disk zero times. That is what keeps a
startup scan imperceptible on a large vault, and why nothing reads file contents
directly. Cost is O(files × rules) with pre-compiled matchers; if that ever
became a problem, a folder-prefix index in `FolderRulePolicySource` would be the
place to add one.

### 11. The settings page uses the imperative API on purpose

Obsidian 1.13.0 added a declarative `getSettingDefinitions()`, which
`eslint-plugin-obsidianmd` prefers. It binds one control to one settings key,
which cannot express a list of folder rules the user adds to and removes from at
will — and adopting it would raise `minAppVersion` from 1.6.6 to 1.13.0 for the
one page that benefits least. The deviation is recorded as a scoped rule
override in `eslint.config.mjs` rather than an inline disable comment.

## Testing

Tests sit beside the code they cover as `*.test.ts`. esbuild only follows
imports from `src/main.ts`, so they are never bundled.

- **Domain** — TTL boundaries, `ttl: 0`, malformed values, the full priority
  order, gitignore anchoring and negation, deepest-rule-wins, tree building.
- **Services** — the whole open-file lifecycle against behavioural fakes in
  `services/test-doubles.ts`: deferral, edit-then-close, close-untouched,
  rename, delete, failure handling and disposal. The fakes really move files and
  really rename on collision, so a failure means the logic is wrong rather than
  an expectation being stale.
- **Architecture** — `src/architecture.test.ts` enforces the layering, and
  asserts it is actually reading files so a typo cannot make it pass vacuously.

## Where to add things

| To add… | Touch |
| --- | --- |
| A new way to claim files | `domain/policy/` — one `PolicySource`, one line in `resolver-factory.ts` |
| A new trigger | `triggers/` — one `CleanupTrigger`, one entry in `main.ts`, add its id to `TriggerId` |
| A new action | `RemovalAction` union, `removal-action.ts`, `pending-actions.ts`'s `executeAction`, `adapters/vault-file-actions.ts` |
| A new setting | `domain/types.ts`, `settings/defaults.ts`, `settings/settings-schema.ts`, `ui/settings-tab.ts` |
| Preview behaviour | `ui/preview-modal.ts` and `ui/tree-view.ts`; the tree's *shape* is `domain/file-tree.ts` |
