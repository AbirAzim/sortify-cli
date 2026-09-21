# sortify

A command-line tool that organizes the files in a folder into meaningfully
named subfolders by content type — `Images`, `Documents`, `Videos`, `Audio`,
`Archives`, `Code`, `Spreadsheets`, `Presentations`, `Executables`, `Fonts`,
and `Others` as a catch-all.

## Install

```bash
npm install
```

Run it directly with Node:

```bash
node bin/sortify.js <folder> [options]
```

Or link it globally so `sortify` is available anywhere:

```bash
npm link
sortify <folder> [options]
```

## Usage

```bash
sortify ~/Downloads --dry-run
sortify ~/Downloads
sortify ~/Downloads --depth 2 --exclude node_modules,.git
sortify . --stage all --exclude archive --verbose
```

### Options

| Flag | Description |
| --- | --- |
| `[folder]` | Folder to organize (default: current directory). |
| `-d, --depth <n>` / `--stage <n>` | How many subfolder levels deep to scan for files. `0` (default) only organizes files directly in `<folder>`. Use `all` for unlimited depth. |
| `-e, --exclude <names...>` | Folder names or relative paths to skip (repeatable, or comma-separated). |
| `--dry-run` | Preview the planned moves without touching any files. |
| `--include-hidden` | Also organize dotfiles (skipped by default). |
| `--no-default-exclude` | Don't automatically skip `.git`, `node_modules`, `dist`, `build`, `.next`, `target`, `vendor`, `.venv`, `__pycache__`. |
| `--force` | Organize even if the folder looks like a source project (has `package.json`, `.git`, etc.) — see **Project guard** below. |
| `-v, --verbose` | Print every file move. |

### Notes

- Files are always moved **into category folders created inside the target
  folder itself** (e.g. `<folder>/Images/photo.jpg`), regardless of how deep
  they were found — this is what actually declutters the folder.
- Name collisions are resolved automatically by appending `(1)`, `(2)`, etc.
- Re-running the tool is safe: it recognizes its own category folders
  (`Images`, `Documents`, ...) and won't re-organize files that are already
  sorted, so it won't create nested `Images/Images` folders.
- Always try `--dry-run` first on a folder you care about.

### Project guard

If the target folder's top level contains a project marker — `package.json`,
`.git`, `pyproject.toml`, `Cargo.toml`, `go.mod`, etc. — `sortify` assumes
it's a source project that's already organized on its own terms and refuses
to touch it, printing a "nothing changed" message instead. Pass `--force` to
override, or just point `sortify` at a subfolder (e.g. `~/project/assets`)
instead of the project root.

## Undo

Every real (non-dry-run) run is recorded in `<folder>/.sortify/history.json`
— a plain JSON log of every move, no database involved. `.sortify` is always
skipped when scanning, so it's never treated as content to organize.

```bash
sortify history ~/Downloads          # list recorded runs
sortify undo ~/Downloads             # undo the most recent run
sortify undo ~/Downloads --run 2     # undo a specific run by id
sortify undo ~/Downloads --all       # undo every run, most recent first
sortify undo ~/Downloads --dry-run   # preview an undo first
```

A move is only restored if the sorted file is still where `sortify` left it
and nothing new has since taken its original spot — otherwise it's reported
as **skipped** rather than overwritten. Category folders (`Images`,
`Documents`, ...) are removed automatically once undoing empties them out.

## Suggest a folder name

`sortify suggest` looks at a folder's contents and proposes a meaningful
name for it — useful for that `New Folder` or `Downloads` pile you've just
organized.

```bash
sortify suggest ~/Downloads/New_Folder
sortify suggest ~/Downloads/New_Folder --rename          # apply it (asks to confirm)
sortify suggest ~/Downloads/New_Folder --rename --yes    # apply it, no prompt
```

Two modes, always available in that order:

1. **Offline heuristic (always works, no network)** — the default. Prefers a
   declared project name (reads `name` from `package.json`, `Cargo.toml`,
   `pyproject.toml`, `go.mod`, `composer.json`, or the first heading in
   `README.md`); otherwise looks at a shared filename pattern (e.g.
   `invoice_2024_01.pdf`, `invoice_2024_02.pdf` → `Invoice`) or the dominant
   file category, plus a date range from file modification times.
2. **AI-powered (opt-in via API key)** — if an Anthropic API key is
   available (`--api-key <key>`, or the `ANTHROPIC_API_KEY` environment
   variable) and `--offline` isn't passed, `sortify` sends the file *names*
   and category breakdown (never file contents) to Claude for a more natural
   suggestion. Any failure — no key, bad key, no network, rate limit — falls
   back to the offline heuristic automatically, with a note explaining why.

`--rename` refuses to touch a folder the project guard would also protect
(`package.json`, `.git`, etc.), and resolves name collisions the same way as
organizing (`Name (1)`, `Name (2)`, ...).

## Project layout

```
bin/sortify.js         # CLI entry point (shebang)
src/cli.js              # Argument parsing (commander), organize/undo/history/suggest commands
src/organizer.js        # Directory walking, collision handling, file moves
src/categorize.js       # Extension -> category mapping, default excludes
src/guard.js            # Project-marker detection (package.json, .git, ...)
src/history.js          # Append-only JSON run log (.sortify/history.json)
src/undo.js             # Reverses recorded runs
src/suggest/analyze.js  # Local content signals: categories, filenames, mtimes, markers
src/suggest/heuristic.js # Offline name suggestion (no network)
src/suggest/ai.js        # Anthropic-powered name suggestion (opt-in via API key)
src/suggest/projectName.js # Reads the declared name from project manifests
src/suggest/index.js     # Picks AI vs. heuristic, handles fallback
```
