<div dir="ltr" align=center>

[**فارسی**](README_fa.md) / [**English**](README.md)

</div>

# Auto Remove

An Obsidian plugin that gives files an expiry date. Notes declare how long they
should live, or a folder decides for them; once the time is up, Auto Remove
shows you exactly what it found and removes only what you confirm.

Vaults accumulate transient notes — inbox captures, daily scratch, half-finished
drafts — that nobody ever gets round to clearing out. Auto Remove clears them
out, without ever surprising you.

Cleanup never runs silently. Whenever expired files are found, a dialog lists
them as a folder tree with every file selected.

## How a file expires

The clock runs from a file's **modified time**, Editing a
file restarts its time to live.

### 1. Notes that opt in

A note participates when its frontmatter says so:

```yaml
---
auto-remove: true
ttl: 3
---
```

| Frontmatter                       | Result                                                                                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auto-remove: true` with `ttl: 3` | Expires 3 days after it was last modified                                                                                                          |
| `auto-remove: true` with no `ttl` | Expires after the default time to live (7 days)                                                                                                    |
| `ttl: 3` with no `auto-remove`    | The `ttl` is ignored. The note has not opted in — but it has not opted out either, so a folder rule may still claim it, using the folder's own TTL |
| `auto-remove: false`              | Never removed, by anything                                                                                                                         |

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

| Priority                    | Wins over                               |
| --------------------------- | --------------------------------------- |
| `auto-remove: false`        | Everything                              |
| `auto-remove: true`         | Folder rules, and their ignore patterns |
| Folder rule (deepest first) | Shallower folder rules                  |
| Ignore patterns             | Any rule above it                       |

## Ignore patterns

Each folder rule takes gitignore-style patterns, one per line, resolved relative
to that rule's folder:

```gitignore
Templates/**
*.canvas
*.pdf
!Templates/keep.md
```

## Actions

**Trash** hands the file to Obsidian, which honours your own _Settings → Files
and links → Deleted files_ preference — system trash, the vault's `.trash`
folder, or permanent deletion.

**Move** relocates the file to a destination folder, creating it if needed and
renaming rather than overwriting if something is already there. Afterwards the
`auto-remove` and `ttl` properties are stripped, so an archived note does not
simply expire again from its new home.
