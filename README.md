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

## Easiest way to use it: just run `sortify`

If you don't want to learn any flags, run it with nothing after it:

```bash
sortify
```

It'll ask you plain-language questions one at a time — which folder, whether
to look inside subfolders (pick with the arrow keys and Enter), anything to
skip — and it'll show you exactly what it plans to do (nothing is moved yet,
color-coded by category) before asking you to confirm. Answer "n" or "No" at
any point and nothing changes. This is the recommended way to use `sortify`
if the flag-based commands below feel like a lot.

Output is colored (categories, warnings, successes) and a progress bar
appears automatically for larger batches (10+ files) — both are skipped
automatically when output isn't a real terminal (piped, redirected to a
file, etc.), so scripts and logs stay clean.

### Combine or split a homogeneous folder

Note this applies both here and to the flag-based `sortify <folder>` command
below, whenever you run it at a real terminal (not piped, not scripted, and
not with `--yes`) — organizing a folder that's entirely one content type
doesn't just silently dump everything under a generic "Images"/"Documents"
folder. `sortify` asks:

```
Every file here is Images — "Images" alone isn't very descriptive.
? How would you like to organize these? › - Use arrow-keys. Return to submit.
❯   Combine them into one folder called "Vacation_Aug_2024"
    Split by filename pattern (e.g. "Invoice" — 2 patterns found)
    Split by month (e.g. "Images_Jan_2024")
    Split by year (e.g. "Images_2024")
    Split by file type (.jpg, .png, .gif)
    Keep the plain "Images" folder
    Don't organize these right now — exit without changes
```

Only the options that actually make sense for these specific files are shown
— e.g. "split by month" only appears if the files really span more than one
month, "split by filename pattern" only if there are genuinely two or more
distinct naming patterns (not just one shared prefix, and not a generic
camera prefix like `IMG`), "split by file type" only if there's more than
one extension in the batch. If none of that applies, you just get Combine,
Keep plain, and Exit.

- **Combine** — everything into one folder with a name inferred from a
  shared filename pattern (skipping generic ones like `IMG`/`DSC`/`Screenshot`)
  or the date range, e.g. `Invoice_2024` or `Vacation_Aug_2024`. Before
  applying it, `sortify` shows exactly what's being grouped — file count,
  extension(s), a few sample filenames, and the reasoning — then lets you
  accept that name (just press Enter) or type your own instead:
  ```
    Grouping: all 19 file(s) (.jpg) — e.g. IMG_0001.jpg, IMG_0002.jpg, ... (Based on mostly Images files (19/19) and dated around Mar_2024.)
  ? Folder name (edit it, or press Enter to accept): › Images_Mar_2024
  ```
- **Split by filename pattern** — clusters files by a shared naming stem,
  e.g. `invoice_01.pdf`, `invoice_02.pdf` → `Invoice/`, alongside
  `receipt_01.pdf`, `receipt_02.pdf` → `Receipt/`. Same as Combine, each
  detected group is shown (its own file count and sample names) before you
  accept or rename it — one prompt per group.
- **Split by month / by year** — groups by file modification date at
  whichever granularity you pick, e.g. `Images_Jan_2024`, `Images_Feb_2024`,
  or just `Images_2024`, `Images_2025`.
- **Split by file type** — groups by extension, e.g. `Images_jpg`,
  `Images_png`.
- **Keep the plain folder** — today's original behavior: one folder named
  after the category, unchanged.
- **Exit without changes** — backs out of organizing this folder entirely;
  nothing is touched. (Ctrl+C works the same way at any prompt.)

Whichever you pick, it re-shows the plan before anything is actually moved,
and `sortify undo` reverses it exactly the same way regardless of choice.

### Also organize the leftover subfolders (depth 0 only)

With the default depth (`0`), `sortify` only ever looks at files sitting
directly in the target folder — any subfolders are left completely alone.
At a real terminal, once it finishes, it now asks about those subfolders
too, one at a time:

```
Also organize the folder "vacation"? › Yes / No, skip it / Exit — stop asking about folders
```

- **Yes** — runs the exact same flow on that subfolder (project-guard check,
  scan, the combine/split/plain/exit question if it turns out homogeneous,
  then the real move) and prints its own summary and undo command. It then
  asks about *that* subfolder's own leftover subfolders too, and so on —
  you can walk an entire tree this way, one folder at a time.
- **No, skip it** — leaves that one folder untouched and moves on to the
  next sibling folder.
- **Exit** — stops the whole walk immediately; nothing further is asked
  about, and no additional folders are touched. (Ctrl+C works the same way.)

This only happens for real (non-`--dry-run`) runs at depth `0`, at a real
terminal, and never with `--yes` or in a script — so automation is
never blocked waiting on input. It skips `.sortify`, any folder covered by
`--exclude` or the default excludes, hidden folders (unless
`--include-hidden`), and folders already named after a known category
(e.g. a pre-existing `Images` folder).

## Usage (flags, for scripting or power users)

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
| `-y, --yes` | Skip the interactive combine/split question below (same as running in a script) and just use the plain category folder. |
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
- If a folder turns out to be all one content type (e.g. a folder of nothing
  but photos), organizing it into one folder named after the category isn't
  very descriptive on its own. When that happens **and you're at a real
  terminal**, `sortify` asks how you'd like to handle it — same as the
  wizard's question, see **Combine or split a homogeneous folder** below.
  In a script or with `--yes`, it skips the question, uses the plain
  category folder, and prints a passive tip instead (with the exact
  `sortify suggest ... --rename` command to apply the same suggestion
  later), so automation is never blocked waiting on input.

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

**By default this works completely offline — no account, no API key, no
cost.** It looks at a declared project name (`name` in `package.json`,
`Cargo.toml`, `pyproject.toml`, `go.mod`, `composer.json`, or the first
heading in `README.md`) if there is one; otherwise it looks at a shared
filename pattern (e.g. `invoice_2024_01.pdf`, `invoice_2024_02.pdf` →
`Invoice`) or the dominant file category, plus a date range from file
modification times. This is what you get automatically, every time.

### Optional: smarter suggestions via Claude (needs an API key)

If you want a more natural-sounding suggestion, `sortify` can ask Claude
instead — but only if you give it an API key; **without one, it just quietly
uses the offline method above, which already works fine for most folders.**

To turn this on:

1. Create an account and an API key at
   **[console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)**.
   This is a separate, pay-as-you-go developer account — it is **not** the
   same as a Claude.ai / Claude Pro subscription, and it needs a payment
   method attached before it will make real requests. (Cost per suggestion
   is tiny — a fraction of a cent — but it isn't free.)
2. Give the key to `sortify` one of two ways:
   ```bash
   export ANTHROPIC_API_KEY="sk-ant-..."     # once per terminal session (or add to ~/.zshrc)
   sortify suggest ~/Downloads/New_Folder

   # or, without setting anything permanently:
   sortify suggest ~/Downloads/New_Folder --api-key "sk-ant-..."
   ```

If the key is missing, wrong, or there's no internet connection, `sortify`
doesn't error out — it silently falls back to the offline method and tells
you why. You can also force offline mode on purpose with `--offline`.

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
src/ui/colors.js        # Color palette (kleur), auto-disabled when not a TTY
src/ui/progress.js      # Progress bar for larger batches
src/ui/spinner.js       # Indeterminate spinner (scanning, AI network calls)
```
