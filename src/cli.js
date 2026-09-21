'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const prompts = require('prompts');
const { Command } = require('commander');
const { organize } = require('./organizer');
const { detectProjectMarkers } = require('./guard');
const { loadHistory: loadRunHistory, HISTORY_DIR_NAME } = require('./history');
const { DEFAULT_EXCLUDE_DIRS, isKnownCategoryFolder } = require('./categorize');
const { undo } = require('./undo');
const { suggestName } = require('./suggest');
const { suggestNameFromFiles, sanitizeName, toTitleCase, extractStem, groupByFilenamePattern } = require('./suggest/heuristic');
const colors = require('./ui/colors');
const { createProgressBar } = require('./ui/progress');
const { createSpinner } = require('./ui/spinner');
const pkg = require('../package.json');

// Exit quietly instead of an ugly stack trace when piped into something
// that closes early (e.g. `sortify ... | head`).
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
});

// Lets people type "~/Desktop" at an interactive prompt, where the shell
// never gets a chance to expand it for them.
function expandHome(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function resolveExistingDir(folder) {
  const targetDir = path.resolve(process.cwd(), expandHome(folder));
  let stat;
  try {
    stat = fs.statSync(targetDir);
  } catch {
    throw new Error(`folder not found: ${targetDir}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`not a directory: ${targetDir}`);
  }
  return targetDir;
}

function onCancel() {
  console.log(colors.warn('\nCancelled — nothing was changed.'));
  process.exit(0);
}

// Only shows a bar for batches large enough that it's actually useful —
// a handful of files finish before a bar would even render meaningfully.
const PROGRESS_THRESHOLD = 10;

function makeProgressHandler(label) {
  let bar = null;
  return (current, total) => {
    if (total <= PROGRESS_THRESHOLD) return;
    if (!bar) bar = createProgressBar(total, label);
    bar.update(current);
    if (current === total) bar.stop();
  };
}

function printMoveSummary(moves, { dryRun }) {
  const byFolder = new Map();
  for (const move of moves) {
    const key = move.folder || move.category;
    byFolder.set(key, (byFolder.get(key) || 0) + 1);
  }
  console.log(colors.bold(`${dryRun ? 'Would organize' : 'Organized'} ${moves.length} file(s) into ${byFolder.size} folder(s):`));
  for (const [folder, count] of [...byFolder.entries()].sort()) {
    console.log(`  ${colors.category(folder)}: ${count}`);
  }
  return byFolder;
}

function monthLabel(date) {
  return date.toLocaleString('en-US', { month: 'short', year: 'numeric' }).replace(' ', '_');
}

/**
 * When a batch of files is all one category (a folder that was already
 * homogeneous), the category name alone — "Images", "Documents" — doesn't
 * describe what's actually in it. Computes a better combined name (same
 * offline heuristic `suggest` uses) plus which alternative ways of splitting
 * the batch actually make sense here — by date, by a distinct filename
 * pattern, or by file type — all from the files already in hand, no extra
 * scan and no network call.
 */
function analyzeHomogeneousBatch(moves, { dryRun }) {
  const byCategory = new Map();
  for (const move of moves) {
    byCategory.set(move.category, (byCategory.get(move.category) || 0) + 1);
  }
  if (byCategory.size !== 1 || moves.length < 2) return null;

  const [category] = [...byCategory.keys()];
  const names = moves.map((m) => path.basename(m.from));

  const fileDates = [];
  for (const move of moves) {
    try {
      fileDates.push(new Date(fs.statSync(dryRun ? move.from : move.to).mtimeMs));
    } catch {
      // Best-effort only — skip a file that vanished in the meantime.
    }
  }
  const dateRange = fileDates.length
    ? { from: new Date(Math.min(...fileDates.map((d) => d.getTime()))), to: new Date(Math.max(...fileDates.map((d) => d.getTime()))) }
    : null;

  const suggestion = suggestNameFromFiles(names, new Map([[category, moves.length]]), dateRange);

  const distinctMonths = new Set(fileDates.map((d) => `${d.getFullYear()}-${d.getMonth()}`));
  const distinctYears = new Set(fileDates.map((d) => d.getFullYear()));

  const patternGroups = groupByFilenamePattern(names);
  const patternCoverage = [...patternGroups.values()].reduce((sum, n) => sum + n, 0);
  const canSplitByPattern = patternGroups.size >= 2 && patternCoverage / names.length >= 0.6;

  const extensions = new Set(names.map((n) => path.extname(n).slice(1).toLowerCase()).filter(Boolean));

  return {
    category,
    suggestion,
    fileDates,
    canSplitByMonth: distinctMonths.size > 1,
    canSplitByYear: distinctYears.size > 1,
    canSplitByPattern,
    patternGroups,
    canSplitByExtension: extensions.size > 1,
    extensions,
  };
}

function printSingleCategoryTip(targetDir, moves, { dryRun }) {
  const info = analyzeHomogeneousBatch(moves, { dryRun });
  if (!info || !info.suggestion.name || info.suggestion.name.toLowerCase() === info.category.toLowerCase()) return;

  const categoryPath = path.join(targetDir, info.category);
  console.log('');
  console.log(colors.info(`Tip: every file here is ${info.category} — "${info.category}" isn't very descriptive on its own.`));
  console.log(colors.dim(`     Maybe rename it to "${info.suggestion.name}" (${info.suggestion.reason})`));
  console.log(colors.dim(`     sortify suggest "${categoryPath}" --rename`));
}

function dateOf(filePath) {
  try {
    return new Date(fs.statSync(filePath).mtimeMs);
  } catch {
    return new Date();
  }
}

/**
 * Describes what's actually in a group of files — file type(s), count,
 * and (if there's room) a couple of sample filenames — so the user has
 * something concrete to judge a suggested name against before accepting
 * or replacing it.
 */
function describeFileGroup(names) {
  const extensions = [...new Set(names.map((n) => path.extname(n).slice(1).toLowerCase()).filter(Boolean))];
  const extLabel = extensions.length ? ` (${extensions.map((e) => `.${e}`).join(', ')})` : '';
  const sample = names.slice(0, 3).join(', ') + (names.length > 3 ? ', ...' : '');
  return `${names.length} file(s)${extLabel} — e.g. ${sample}`;
}

/**
 * Shows what's being grouped, then a text prompt pre-filled with the
 * suggested name — Enter accepts it as-is, or the user can edit/replace it
 * entirely before submitting. This is the one spot every generated folder
 * name passes through, so nothing gets applied without the user seeing it
 * first.
 */
async function confirmOrEditName(defaultName, groupDescription) {
  console.log(colors.dim(`\n  Grouping: ${groupDescription}`));
  const { name } = await prompts(
    { type: 'text', name: 'name', message: 'Folder name (edit it, or press Enter to accept):', initial: defaultName },
    { onCancel }
  );
  return sanitizeName((name || '').trim() || defaultName);
}

/**
 * Asks — with a real select prompt — how a homogeneous batch of files
 * should be organized: combined into one meaningfully-named folder, split
 * several different ways (by filename pattern, by month/year, by file
 * type — whichever ones actually apply to this batch), left under the
 * plain category name, or not organized at all right now. Returns the
 * resulting `folderNameOverride` (for organize()), the re-scanned moves
 * reflecting that choice, and `cancelled: true` if the user chose to exit —
 * callers must check `cancelled` and stop rather than proceeding to
 * organize anyway. No-op when there's nothing meaningful to ask.
 */
async function promptHomogeneousChoice(organizeOptions, moves, { dryRun }) {
  const homogeneous = analyzeHomogeneousBatch(moves, { dryRun });
  if (!homogeneous || !homogeneous.suggestion.name || homogeneous.suggestion.name.toLowerCase() === homogeneous.category.toLowerCase()) {
    return { folderNameOverride: undefined, moves, cancelled: false };
  }

  const { category, suggestion, fileDates, canSplitByMonth, canSplitByYear, canSplitByPattern, patternGroups, canSplitByExtension, extensions } =
    homogeneous;
  console.log(colors.info(`\nEvery file here is ${category} — "${category}" alone isn't very descriptive.`));

  const choices = [{ title: `Combine them into one folder called "${suggestion.name}"`, value: 'combine' }];

  if (canSplitByPattern) {
    const [topStem] = [...patternGroups.entries()].sort((a, b) => b[1] - a[1])[0];
    choices.push({
      title: `Split by filename pattern (e.g. "${toTitleCase(topStem)}" — ${patternGroups.size} patterns found)`,
      value: 'split-pattern',
    });
  }
  if (canSplitByMonth) {
    choices.push({ title: `Split by month (e.g. "${category}_${monthLabel(fileDates[0])}")`, value: 'split-month' });
  }
  if (canSplitByYear) {
    choices.push({ title: `Split by year (e.g. "${category}_${fileDates[0].getFullYear()}")`, value: 'split-year' });
  }
  if (canSplitByExtension) {
    const sample = [...extensions].slice(0, 3).map((e) => `.${e}`).join(', ');
    choices.push({ title: `Split by file type (${sample}${extensions.size > 3 ? ', ...' : ''})`, value: 'split-ext' });
  }
  choices.push({ title: `Keep the plain "${category}" folder`, value: 'plain' });
  choices.push({ title: "Don't organize these right now — exit without changes", value: 'exit' });

  const { howToOrganize } = await prompts(
    { type: 'select', name: 'howToOrganize', message: 'How would you like to organize these?', choices, initial: 0 },
    { onCancel }
  );

  if (howToOrganize === 'exit') {
    return { folderNameOverride: undefined, moves, cancelled: true };
  }

  const names = moves.map((m) => path.basename(m.from));

  let folderNameOverride;
  if (howToOrganize === 'combine') {
    const finalName = await confirmOrEditName(suggestion.name, `all ${describeFileGroup(names)} (${suggestion.reason})`);
    folderNameOverride = () => finalName;
  } else if (howToOrganize === 'split-month') {
    console.log(colors.dim(`\n  Grouping: ${describeFileGroup(names)}, split into folders by month.`));
    folderNameOverride = ({ filePath, category: cat }) => `${cat}_${monthLabel(dateOf(filePath))}`;
  } else if (howToOrganize === 'split-year') {
    console.log(colors.dim(`\n  Grouping: ${describeFileGroup(names)}, split into folders by year.`));
    folderNameOverride = ({ filePath, category: cat }) => `${cat}_${dateOf(filePath).getFullYear()}`;
  } else if (howToOrganize === 'split-pattern') {
    const stemToNames = new Map();
    for (const name of names) {
      const stem = extractStem(name);
      if (patternGroups.has(stem)) {
        if (!stemToNames.has(stem)) stemToNames.set(stem, []);
        stemToNames.get(stem).push(name);
      }
    }

    const stemNameMap = new Map();
    for (const [stem, stemNames] of stemToNames) {
      const finalName = await confirmOrEditName(toTitleCase(stem), describeFileGroup(stemNames));
      stemNameMap.set(stem, finalName);
    }

    folderNameOverride = ({ filename, category: cat }) => {
      const stem = extractStem(filename);
      return stemNameMap.has(stem) ? stemNameMap.get(stem) : `${cat}_Other`;
    };
  } else if (howToOrganize === 'split-ext') {
    console.log(colors.dim(`\n  Grouping: ${describeFileGroup(names)}, split into folders by file type.`));
    folderNameOverride = ({ filename, category: cat }) => {
      const ext = path.extname(filename).slice(1).toLowerCase();
      return ext ? `${cat}_${ext}` : cat;
    };
  }
  // 'plain' => no override, keep the default category folder

  if (!folderNameOverride) {
    return { folderNameOverride: undefined, moves, cancelled: false };
  }

  const rescan = await organize({ ...organizeOptions, dryRun: true, folderNameOverride });
  console.log('');
  printMoveSummary(rescan.moves, { dryRun: true });
  return { folderNameOverride, moves: rescan.moves, cancelled: false };
}

/**
 * Lists the subfolders directly inside `parentDir` that a depth-0 run never
 * looked inside — i.e. everything except folders this run just created/used
 * (`justUsedFolderNames`), sortify's own metadata folder, any known category
 * folder name (already "organized" by definition), hidden folders (unless
 * --include-hidden), and anything covered by --exclude / the default excludes.
 */
async function listLeftoverSubfolders(parentDir, justUsedFolderNames, organizeOptions) {
  const entries = await fs.promises.readdir(parentDir, { withFileTypes: true });
  const excludeNames = new Set(organizeOptions.exclude.map((e) => e.toLowerCase()));
  const defaultExcludeNames = organizeOptions.useDefaultExcludes ? new Set(DEFAULT_EXCLUDE_DIRS.map((n) => n.toLowerCase())) : new Set();

  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => {
      if (name === HISTORY_DIR_NAME) return false;
      if (!organizeOptions.includeHidden && name.startsWith('.')) return false;
      if (justUsedFolderNames.has(name)) return false;
      if (isKnownCategoryFolder(name)) return false;
      if (excludeNames.has(name.toLowerCase())) return false;
      if (defaultExcludeNames.has(name.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => a.localeCompare(b));
}

/**
 * After a depth-0 run finishes, walks any subfolders it never looked
 * inside and asks — one at a time, Yes / No / Exit — whether to organize
 * each one too. "Yes" runs the exact same flow on that subfolder (project
 * guard, scan, the combine/split/plain/exit question if it's homogeneous,
 * then the real move) and then recurses into *its* leftover subfolders.
 * "No" skips just that folder and moves to the next sibling. "Exit" stops
 * the whole walk immediately — no more folders are asked about.
 */
async function offerToOrganizeSubfolders(parentDir, organizeOptions, justUsedFolderNames) {
  const leftovers = await listLeftoverSubfolders(parentDir, justUsedFolderNames, organizeOptions);

  for (const name of leftovers) {
    const subDir = path.join(parentDir, name);

    const { action } = await prompts(
      {
        type: 'select',
        name: 'action',
        message: `Also organize the folder "${name}"?`,
        choices: [
          { title: 'Yes', value: 'yes' },
          { title: 'No, skip it', value: 'no' },
          { title: 'Exit — stop asking about folders', value: 'exit' },
        ],
        initial: 0,
      },
      { onCancel }
    );

    if (action === 'exit') return;
    if (action === 'no') continue;

    const subProjectMarkers = detectProjectMarkers(subDir);
    if (subProjectMarkers.length > 0) {
      console.log(colors.warn(`\nSkipping "${name}": looks like a project folder (found: ${subProjectMarkers.join(', ')}).`));
      continue;
    }

    const subOrganizeOptions = { ...organizeOptions, targetDir: subDir, depth: 0 };
    const scan = await organize({ ...subOrganizeOptions, dryRun: true });

    if (scan.moves.length === 0) {
      console.log(colors.dim(`\n"${name}" has nothing to organize.`));
      continue;
    }

    console.log('');
    printMoveSummary(scan.moves, { dryRun: true });

    const choice = await promptHomogeneousChoice(subOrganizeOptions, scan.moves, { dryRun: true });
    if (choice.cancelled) {
      console.log(colors.dim(`\nSkipped "${name}".`));
      continue;
    }

    const onProgress = makeProgressHandler('Organizing');
    const result = await organize({ ...subOrganizeOptions, dryRun: false, onProgress, folderNameOverride: choice.folderNameOverride });

    console.log(colors.success(`\nOrganized ${result.moves.length} file(s) in "${name}".`));
    if (result.run) {
      console.log(colors.dim(`Undo with: sortify undo --run ${result.run.id} "${subDir}"`));
    }

    const touchedInSub = new Set(result.moves.map((m) => m.folder));
    await offerToOrganizeSubfolders(subDir, subOrganizeOptions, touchedInSub);
  }
}

/**
 * A guided, plain-language walkthrough for people who don't want to learn
 * the flags. Triggered when sortify is run with no arguments at all. Uses
 * real arrow-key select / confirm prompts (from the `prompts` package) —
 * automatable in tests via `prompts.inject()`.
 */
async function runWizard() {
  console.log(colors.heading("Hi! Let's organize a folder together — I'll explain each step.\n"));

  const { folder } = await prompts(
    {
      type: 'text',
      name: 'folder',
      message: 'Which folder do you want to organize?',
      initial: process.cwd(),
    },
    { onCancel }
  );

  let targetDir;
  try {
    targetDir = resolveExistingDir(folder);
  } catch (err) {
    console.log(colors.error(`\nI couldn't find that folder (${err.message}). Nothing was changed.`));
    return;
  }

  console.log(colors.dim(`\nGot it: ${targetDir}\n`));

  const { depth } = await prompts(
    {
      type: 'select',
      name: 'depth',
      message: 'Should I also look inside subfolders?',
      choices: [
        { title: 'No — just the files directly in this folder', value: 0 },
        { title: 'Yes — one level of subfolders too', value: 1 },
        { title: 'Yes — dig through everything, no matter how deep', value: Infinity },
      ],
      initial: 0,
    },
    { onCancel }
  );

  const { excludeAnswer } = await prompts(
    {
      type: 'text',
      name: 'excludeAnswer',
      message: "Any folders you'd like me to leave alone? (comma-separated, or leave blank)",
      initial: '',
    },
    { onCancel }
  );
  const exclude = excludeAnswer ? excludeAnswer.split(',').map((s) => s.trim()).filter(Boolean) : [];

  const projectMarkers = detectProjectMarkers(targetDir);
  if (projectMarkers.length > 0) {
    console.log(colors.warn(`\nHeads up: this looks like a project folder (it has a ${projectMarkers[0]}), not a messy pile of files — organizing it could break it.`));
    const { proceed } = await prompts({ type: 'confirm', name: 'proceed', message: 'Organize it anyway?', initial: false }, { onCancel });
    if (!proceed) {
      console.log(colors.dim('\nOkay, I left it alone. Nothing was changed.'));
      return;
    }
  }

  const organizeOptions = { targetDir, exclude, depth, includeHidden: false, useDefaultExcludes: true };

  const scanSpinner = createSpinner('Looking through the folder...');
  const preview = await organize({ ...organizeOptions, dryRun: true });
  scanSpinner.stop();

  if (preview.moves.length === 0) {
    console.log(colors.success("\nI didn't find anything that needs organizing here. All done!"));
    return;
  }

  console.log('');
  printMoveSummary(preview.moves, { dryRun: true });

  const { folderNameOverride, cancelled } = await promptHomogeneousChoice(organizeOptions, preview.moves, { dryRun: true });
  if (cancelled) {
    console.log(colors.dim('\nOkay, nothing was changed. Run me again anytime.'));
    return;
  }

  const { confirmed } = await prompts({ type: 'confirm', name: 'confirmed', message: 'Go ahead and organize them now?', initial: false }, { onCancel });
  if (!confirmed) {
    console.log(colors.dim('\nNo problem, nothing was changed. Run me again anytime.'));
    return;
  }

  console.log('');
  const onProgress = makeProgressHandler('Organizing');
  const result = await organize({ ...organizeOptions, dryRun: false, onProgress, folderNameOverride });
  console.log(colors.success(`\nAll done! I organized ${result.moves.length} file(s).`));
  if (result.run) {
    console.log(colors.dim(`If you change your mind, undo it with: sortify undo --run ${result.run.id} "${folder}"`));
  }

  if (depth === 0) {
    const touchedFolderNames = new Set(result.moves.map((m) => m.folder));
    await offerToOrganizeSubfolders(targetDir, organizeOptions, touchedFolderNames);
  }
}

function collect(value, previous) {
  return previous.concat(value.split(',').map((s) => s.trim()).filter(Boolean));
}

function parseDepth(value) {
  if (value === undefined) return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'all' || normalized === 'infinite' || normalized === 'unlimited') {
    return Infinity;
  }
  const n = Number.parseInt(normalized, 10);
  if (Number.isNaN(n) || n < 0) {
    throw new Error(`Invalid depth/stage value: "${value}". Use a non-negative number, or "all".`);
  }
  return n;
}

const program = new Command();

program
  .name('sortify')
  .description(
    'Organize the files in a folder into meaningfully named subfolders by content type (Images, Documents, Videos, ...).\n\n' +
      "Tip: not sure about the options below? Just run \"sortify\" by itself and I'll walk you through it step by step."
  )
  .version(pkg.version)
  .argument('[folder]', 'Folder to organize', '.')
  .option('-e, --exclude <names...>', 'Folder names or relative paths to exclude (repeatable, or comma-separated)', collect, [])
  .option('-d, --depth <n>', "How many subfolder levels deep to look for files. 0 = only the top-level files in <folder>. Use 'all' for unlimited. (also called --stage)")
  .option('--stage <n>', 'Alias for --depth')
  .option('--dry-run', 'Preview what would be moved without touching any files', false)
  .option('--include-hidden', 'Also organize hidden (dotfile) files', false)
  .option('--no-default-exclude', "Don't automatically skip .git, node_modules, dist, build, etc.")
  .option('--force', 'Organize even if the folder looks like a source project (has package.json, .git, etc.)', false)
  .option('-y, --yes', "Skip the interactive combine/split question at a real terminal and just use the plain category folder — same as running in a script", false)
  .option('-v, --verbose', 'Print every planned/performed move', false)
  .action(async (folder, options) => {
    let targetDir;
    try {
      targetDir = resolveExistingDir(folder);
    } catch (err) {
      console.error(colors.error(`Error: ${err.message}`));
      process.exitCode = 1;
      return;
    }

    let depth;
    try {
      depth = parseDepth(options.stage ?? options.depth ?? '0');
    } catch (err) {
      console.error(colors.error(`Error: ${err.message}`));
      process.exitCode = 1;
      return;
    }

    const projectMarkers = detectProjectMarkers(targetDir);
    if (projectMarkers.length > 0 && !options.force) {
      console.log(colors.warn(`Skipping: ${targetDir}`));
      console.log(colors.warn(`This looks like a project folder (found: ${projectMarkers.join(', ')}) — it's already organized on its own terms, not a pile of loose files to sort.`));
      console.log('Nothing was changed. Pass --force to organize it anyway, or point sortify at a subfolder instead.');
      return;
    }

    console.log(colors.heading(`${options.dryRun ? '[dry run] ' : ''}Organizing: ${targetDir}`));
    console.log(colors.dim(`Depth (stage): ${depth === Infinity ? 'all' : depth}${options.exclude.length ? `  |  Excluding: ${options.exclude.join(', ')}` : ''}`));

    const organizeOptions = {
      targetDir,
      exclude: options.exclude,
      depth,
      includeHidden: options.includeHidden,
      useDefaultExcludes: options.defaultExclude,
    };

    try {
      const scanOnProgress = makeProgressHandler('Scanning');
      const scan = await organize({ ...organizeOptions, dryRun: true, onProgress: scanOnProgress });

      if (scan.moves.length === 0) {
        console.log('Nothing to organize — no matching files found.');
        return;
      }

      console.log('');
      printMoveSummary(scan.moves, { dryRun: true });

      // Only ask interactively at a real terminal — piped/scripted/CI usage
      // (or --yes) stays fully non-interactive and gets the passive tip
      // instead, so automation never blocks waiting on stdin.
      const isInteractive = Boolean(process.stdout.isTTY && process.stdin.isTTY) && !options.yes;

      let moves = scan.moves;
      let folderNameOverride;
      if (isInteractive) {
        const choice = await promptHomogeneousChoice(organizeOptions, moves, { dryRun: true });
        if (choice.cancelled) {
          console.log(colors.dim('\nNothing was changed.'));
          return;
        }
        folderNameOverride = choice.folderNameOverride;
        moves = choice.moves;
      } else {
        printSingleCategoryTip(targetDir, moves, { dryRun: true });
      }

      if (options.dryRun) {
        if (options.verbose) {
          console.log('');
          for (const move of moves) {
            console.log(`  would move: ${colors.dim(path.relative(targetDir, move.from))} -> ${colors.category(move.folder)}/${path.basename(move.to)}`);
          }
        }
        console.log(colors.dim('\nRun again without --dry-run to apply these changes.'));
        return;
      }

      const onProgress = makeProgressHandler('Organizing');
      const result = await organize({ ...organizeOptions, dryRun: false, onProgress, folderNameOverride });

      if (options.verbose) {
        console.log('');
        for (const move of result.moves) {
          console.log(`  moved: ${colors.dim(path.relative(targetDir, move.from))} -> ${colors.category(move.folder)}/${path.basename(move.to)}`);
        }
      }

      console.log(colors.success(`\nOrganized ${result.moves.length} file(s).`));
      if (result.run) {
        console.log(colors.dim(`Recorded as run #${result.run.id}. Undo with: sortify undo --run ${result.run.id} "${folder}"`));
      }

      if (isInteractive && depth === 0) {
        const touchedFolderNames = new Set(result.moves.map((m) => m.folder));
        await offerToOrganizeSubfolders(targetDir, organizeOptions, touchedFolderNames);
      }
    } catch (err) {
      console.error(colors.error(`Error: ${err.message}`));
      process.exitCode = 1;
    }
  });

program
  .command('undo [folder]')
  .description('Undo a previous sortify run in <folder> (default: the most recent run, current directory)')
  .option('--run <id>', 'Undo a specific run by id instead of the most recent', (v) => Number.parseInt(v, 10))
  .option('--all', 'Undo every not-yet-undone run for this folder, most recent first', false)
  .option('--dry-run', 'Preview what would be restored without moving anything', false)
  .action(async (folder = '.', options) => {
    let targetDir;
    try {
      targetDir = resolveExistingDir(folder);
    } catch (err) {
      console.error(colors.error(`Error: ${err.message}`));
      process.exitCode = 1;
      return;
    }

    try {
      const report = await undo({
        targetDir,
        runId: options.run,
        all: options.all,
        dryRun: options.dryRun,
      });

      if (report.length === 0) {
        const history = await loadRunHistory(targetDir);
        if (history.length === 0) {
          console.log('Nothing to undo — no recorded runs found for this folder.');
        } else {
          console.log('Nothing to undo — all recorded runs for this folder have already been undone.');
        }
        return;
      }

      for (const entry of report) {
        console.log(colors.heading(`${options.dryRun ? '[dry run] ' : ''}Run #${entry.id} (${entry.timestamp}):`));
        for (const move of entry.restored) {
          console.log(`  ${colors.success(options.dryRun ? 'would restore' : 'restored')}: ${path.relative(targetDir, move.to)} -> ${path.relative(targetDir, move.from)}`);
        }
        for (const move of entry.skipped) {
          console.log(`  ${colors.warn('skipped')}: ${path.relative(targetDir, move.to)} (${move.reason})`);
        }
        console.log(colors.dim(`  ${entry.restored.length} restored, ${entry.skipped.length} skipped.`));
      }
      if (options.dryRun) {
        console.log(colors.dim('\nRun again without --dry-run to apply this undo.'));
      }
    } catch (err) {
      console.error(colors.error(`Error: ${err.message}`));
      process.exitCode = 1;
    }
  });

program
  .command('history [folder]')
  .description('List recorded sortify runs for <folder> (default: current directory)')
  .action(async (folder = '.') => {
    let targetDir;
    try {
      targetDir = resolveExistingDir(folder);
    } catch (err) {
      console.error(colors.error(`Error: ${err.message}`));
      process.exitCode = 1;
      return;
    }

    const history = await loadRunHistory(targetDir);
    if (history.length === 0) {
      console.log('No recorded runs for this folder.');
      return;
    }

    for (const run of history) {
      const status = run.undone ? colors.dim(`undone at ${run.undoneAt}`) : colors.success('active');
      console.log(`#${run.id}  ${run.timestamp}  ${run.moves.length} file(s)  depth=${run.depth}  [${status}]`);
    }
  });

program
  .command('suggest [folder]')
  .description('Suggest a meaningful name for <folder> based on its contents (default: current directory)')
  .option('-d, --depth <n>', "How many subfolder levels deep to look at. Use 'all' for unlimited.", '1')
  .option('--api-key <key>', 'Anthropic API key for AI-powered suggestions (defaults to the ANTHROPIC_API_KEY env var)')
  .option('--offline', 'Skip AI and use the offline heuristic only, even if an API key is available', false)
  .option('--rename', 'Rename the folder to the suggested name', false)
  .option('--yes', 'Skip the rename confirmation prompt', false)
  .action(async (folder = '.', options) => {
    let targetDir;
    try {
      targetDir = resolveExistingDir(folder);
    } catch (err) {
      console.error(colors.error(`Error: ${err.message}`));
      process.exitCode = 1;
      return;
    }

    let depth;
    try {
      depth = parseDepth(options.depth);
    } catch (err) {
      console.error(colors.error(`Error: ${err.message}`));
      process.exitCode = 1;
      return;
    }

    let suggestion;
    const thinkingSpinner = createSpinner('Thinking of a good name...');
    try {
      suggestion = await suggestName(targetDir, { depth, apiKey: options.apiKey, offline: options.offline });
      thinkingSpinner.stop();
    } catch (err) {
      thinkingSpinner.stop();
      console.error(colors.error(`Error: ${err.message}`));
      process.exitCode = 1;
      return;
    }

    if (!suggestion.name) {
      console.log(suggestion.reason);
      return;
    }

    console.log(colors.bold(`Suggested name (${suggestion.mode}): `) + colors.success(suggestion.name));
    console.log(colors.dim(suggestion.reason));
    if (suggestion.warning) console.log(colors.warn(`Note: ${suggestion.warning}`));

    if (!options.rename) {
      return;
    }

    const projectMarkers = detectProjectMarkers(targetDir);
    if (projectMarkers.length > 0) {
      console.log(colors.warn(`\nRefusing to rename: this looks like a project folder (found: ${projectMarkers.join(', ')}).`));
      return;
    }

    const parentDir = path.dirname(targetDir);
    let destPath = path.join(parentDir, suggestion.name);
    let counter = 1;
    while (fs.existsSync(destPath)) {
      destPath = path.join(parentDir, `${suggestion.name} (${counter})`);
      counter += 1;
    }

    if (!options.yes) {
      const { confirmed } = await prompts(
        { type: 'confirm', name: 'confirmed', message: `Rename "${path.basename(targetDir)}" to "${path.basename(destPath)}"?`, initial: false },
        { onCancel }
      );
      if (!confirmed) {
        console.log('Rename cancelled.');
        return;
      }
    }

    fs.renameSync(targetDir, destPath);
    console.log(colors.success(`Renamed to: ${destPath}`));
  });

if (process.argv.slice(2).length === 0) {
  runWizard();
} else {
  program.parse();
}
