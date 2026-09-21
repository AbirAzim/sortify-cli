'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const prompts = require('prompts');
const { Command } = require('commander');
const { organize } = require('./organizer');
const { detectProjectMarkers } = require('./guard');
const { loadHistory: loadRunHistory } = require('./history');
const { undo } = require('./undo');
const { suggestName } = require('./suggest');
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
  const byCategory = new Map();
  for (const move of moves) {
    byCategory.set(move.category, (byCategory.get(move.category) || 0) + 1);
  }
  console.log(colors.bold(`${dryRun ? 'Would organize' : 'Organized'} ${moves.length} file(s) into ${byCategory.size} folder(s):`));
  for (const [category, count] of [...byCategory.entries()].sort()) {
    console.log(`  ${colors.category(category)}: ${count}`);
  }
  return byCategory;
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

  const scanSpinner = createSpinner('Looking through the folder...');
  const preview = await organize({ targetDir, exclude, depth, dryRun: true, includeHidden: false, useDefaultExcludes: true });
  scanSpinner.stop();

  if (preview.moves.length === 0) {
    console.log(colors.success("\nI didn't find anything that needs organizing here. All done!"));
    return;
  }

  console.log('');
  printMoveSummary(preview.moves, { dryRun: true });

  const { confirmed } = await prompts({ type: 'confirm', name: 'confirmed', message: 'Go ahead and organize them now?', initial: false }, { onCancel });
  if (!confirmed) {
    console.log(colors.dim('\nNo problem, nothing was changed. Run me again anytime.'));
    return;
  }

  console.log('');
  const onProgress = makeProgressHandler('Organizing');
  const result = await organize({ targetDir, exclude, depth, dryRun: false, includeHidden: false, useDefaultExcludes: true, onProgress });
  console.log(colors.success(`\nAll done! I organized ${result.moves.length} file(s).`));
  if (result.run) {
    console.log(colors.dim(`If you change your mind, undo it with: sortify undo --run ${result.run.id} "${folder}"`));
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

    try {
      const onProgress = makeProgressHandler(options.dryRun ? 'Scanning' : 'Organizing');
      const { moves, run } = await organize({
        targetDir,
        exclude: options.exclude,
        depth,
        dryRun: options.dryRun,
        includeHidden: options.includeHidden,
        useDefaultExcludes: options.defaultExclude,
        onProgress,
      });

      if (moves.length === 0) {
        console.log('Nothing to organize — no matching files found.');
        return;
      }

      if (options.verbose) {
        for (const move of moves) {
          const verb = options.dryRun ? 'would move' : 'moved';
          console.log(`  ${verb}: ${colors.dim(path.relative(targetDir, move.from))} -> ${colors.category(move.category)}/${path.basename(move.to)}`);
        }
      }

      console.log('');
      printMoveSummary(moves, { dryRun: options.dryRun });
      if (options.dryRun) {
        console.log(colors.dim('\nRun again without --dry-run to apply these changes.'));
      } else if (run) {
        console.log(colors.success(`\nOrganized ${moves.length} file(s).`));
        console.log(colors.dim(`Recorded as run #${run.id}. Undo with: sortify undo --run ${run.id} "${folder}"`));
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
