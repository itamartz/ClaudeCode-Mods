# athena-progress

A Claude Code mod that adds a `/progress` pane. The pane shows the progress JSON files that Claude subagents write to a folder. Running work is listed first, with its tasks; finished work collapses to one green 😊 line.

## Install

Push this repository to GitHub as `itamartz/ClaudeCode-Mods`. Then, on any computer, run this in a Claude Code terminal session:

```
/plugin install athena-progress --marketplace itamartz/ClaudeCode-Mods
```

Answer `y` to add the marketplace, then pick a scope. The `owner/repo` in that line must match the GitHub repository name exactly.

For local development, run from the folder instead:

```
claude --plugin-dir <path>\progress
```

## Configure

The mod reads `C:\Users\Itamartz\AthenaDev\progress` by default. If the folder is elsewhere on a machine, set the `progressDir` option, either in the config menu (`/config`) or in settings under `pluginConfigs`:

```json
"pluginConfigs": {
  "athena-progress": { "progressDir": "D:\work\progress" }
}
```

## Commands

| Command | What it does |
|---|---|
| `/progress` | Toggle the pane |
| `/progress refresh` | Re-read the folder now |
| `/progress clear` | Hide finished files until they change |

## Progress file format

One `*.json` file per piece of work:

```json
{
  "title": "BIOS phase 2",
  "updated": "yyyy/MM/dd HH:mm:ss",
  "now": { "action": "Running E2E", "since": "yyyy/MM/dd HH:mm:ss" },
  "tasks": [
    { "name": "Catalog", "status": "done|running|pending|failed", "detail": "42 attributes" }
  ]
}
```

Loose formats are tolerated: status aliases (`ok`, `pass`, `complete`, `completed`, `fail`, `error`) and extra words, tasks given as plain strings, and missing fields all still render.

## Tests

From the repository root:

```
claude plugin test progress
```
