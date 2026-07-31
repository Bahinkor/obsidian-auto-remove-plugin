# Auto Remove

An Obsidian plugin that gives files an expiry date. Notes declare how long they
should live, or a folder decides for them; once the time is up, Auto Remove
shows you exactly what it found and removes only what you confirm.

Vaults accumulate transient notes — inbox captures, daily scratch, half-finished
drafts — that nobody ever gets round to clearing out. Auto Remove clears them
out, without ever surprising you.

## How a file expires

The clock runs from a file's **modified time**, not its creation time. Editing a
file restarts its time to live.

### 1. Notes that opt in

A note participates when its frontmatter says so:

```yaml
---
auto-remove: true
ttl: 3
---
```

| Frontmatter | Result |
| --- | --- |
| `auto-remove: true` with `ttl: 3` | Expires 3 days after it was last modified |
| `auto-remove: true` with no `ttl` | Expires after the default time to live (7 days) |
| `ttl: 3` with no `auto-remove` | The `ttl` is ignored. The note has not opted in — but it has not opted out either, so a folder rule may still claim it, using the folder's own TTL |
| `auto-remove: false` | Never removed, by anything |

Opted-in notes use the **default action** and **default destination** from
settings. Folder rules never apply to them: an explicit opt-in is treated as the
note's own instruction and outranks everything else.

`auto-remove: false` is the mirror image — an explicit refusal that no folder
rule can override. It is how you exempt a single note from a rule covering its
folder.

### 2. Folder rules

A folder rule applies a time to live to every file inside a folder, at any
depth, including attachments and other non-Markdown files. Each rule sets its
own TTL, action, destination and ignore patterns.

When rules nest, **the most specific folder wins** — a rule on `Inbox/drafts`
overrides one on `Inbox`.

### 3. Anything else

A file no note and no rule claims is left alone. Auto Remove never acts on a
file it was not explicitly told about.

### In short

| Priority | Wins over |
| --- | --- |
| `auto-remove: false` | Everything |
| `auto-remove: true` | Folder rules, and their ignore patterns |
| Folder rule (deepest first) | Shallower folder rules |
| Ignore patterns | The rule that owns them, and any rule above it |

## Ignore patterns

Each folder rule takes gitignore-style patterns, one per line, resolved relative
to that rule's folder:

```gitignore
Templates/**
*.canvas
*.pdf
!Templates/keep.md
```

Negation with `!` re-includes a path, and `#` starts a comment. A pattern
containing a slash is anchored to the rule's folder, exactly as it would be in a
`.gitignore` — use `**/Templates/**` to match at any depth.

Ignore patterns narrow a folder rule. They do not override an explicit
`auto-remove: true`, which sits above them in the priority order.

## Actions

**Trash** hands the file to Obsidian, which honours your own *Settings → Files
and links → Deleted files* preference — system trash, the vault's `.trash`
folder, or permanent deletion. Auto Remove keeps no trash of its own.

**Move** relocates the file to a destination folder, creating it if needed and
renaming rather than overwriting if something is already there. Afterwards the
`auto-remove` and `ttl` properties are stripped, so an archived note does not
simply expire again from its new home.

## Files you have open

A file open in an editor is never moved or deleted. It waits for the tab to
close, and is then re-examined rather than acted on from memory:

- **Edited before closing** — its modified time moved, its TTL restarted, and
  the pending action is dropped.
- **Closed without changes** — the action runs immediately.

This covers every pane, including sidebars and pop-out windows. Nothing survives
a restart: the next scan simply finds whatever is still expired.

## Preview

Cleanup never runs silently. Whenever expired files are found, a dialog lists
them as a folder tree with every file selected, showing each one's age, TTL,
action and where its policy came from. Uncheck anything you want to keep — by
file or by folder — then confirm. Cancelling, or closing the window, does
nothing at all.

```
☑ Inbox
  ├── ideas
  │   ├── note1.md      12 days ago · TTL 7 days · Trash
  │   └── note2.md      9 days ago  · TTL 7 days · Trash
  └── drafts
      └── old.md        30 days ago · TTL 14 days · Move to Archive
```

## Settings

- **Default time to live**, **default action** and **default destination folder**
  for notes that opt in via frontmatter.
- **Cleanup trigger** — on Obsidian startup (default), or manual command only.
- **Folder rules** — folder, time to live, action, destination and ignore
  patterns, each rule individually pausable.

## Commands

- **Auto Remove: Run cleanup** — scans and opens the preview. Always available,
  whatever the trigger setting says.

## Installing

Auto Remove is not yet in the community plugin browser. To install it manually,
copy `main.js`, `manifest.json` and `styles.css` into
`<vault>/.obsidian/plugins/auto-remove/` and enable it under *Settings →
Community plugins*.

## Developing

```bash
npm install
npm run dev
```

`npm run dev` rebuilds `main.js` on every change. Point it at a test vault by
symlinking the plugin folder, then reload Obsidian to pick up a build.

```bash
npm test     # unit tests
npm run lint # ESLint, including the official Obsidian plugin rules
npm run build # type-check and produce a production bundle
```

The design and the reasoning behind it are documented in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Licence

MIT — see [LICENSE](LICENSE).
