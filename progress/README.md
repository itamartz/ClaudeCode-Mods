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
| `/progress clear tasks` | Hide the done tasks inside running files (kept across sessions; the summary line adds `n hidden`). A task that becomes done later hides at the next `clear tasks` |
| `/progress clear all` | Both of the above |
| `/progress show` | Un-hide everything hidden by `clear` and `clear tasks` |

## Progress file format

One `*.json` file per piece of work:

```json
{
  "title": "BIOS phase 2",
  "updated": "yyyy/MM/dd HH:mm:ss",
  "now": { "action": "Running E2E", "since": "yyyy/MM/dd HH:mm:ss" },
  "tasks": [
    { "name": "Catalog", "status": "done|running|pending|failed|waiting", "detail": "42 attributes" }
  ]
}
```

Loose formats are tolerated: status aliases (`ok`, `pass`, `complete`, `completed`, `fail`, `error`, `wait`, `blocked-on-user`) and extra words, tasks given as plain strings, and missing fields all still render.

## Waiting for the user

A task with status `waiting` asks the user something; put the question in `detail`:

```json
{ "name": "Merge", "status": "waiting", "detail": "OK to merge PR #330?" }
```

It draws as a highlighted `🙋 Merge — OK to merge PR #330?` line with three buttons under it: **Done**, **In progress** and **Blocked**. A file with any waiting task is never shown as finished and sorts first, ahead of running files; its summary line counts `N waiting`.

Pressing a button submits `[progress] <title> › <task>: <answer>` into the Claude session as a user turn (`$.prompt.submit`), so the main Claude reads it and continues. The engine queues it: it starts once the session is idle, never mid-turn. The line then shows `✓ answered: <answer>` until the file's `updated` changes. The mod only reads the progress folder; the answer is never written back to the file.

## Tests

From the repository root:

```
claude plugin test progress
```
