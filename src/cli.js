'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const readline = require('readline');
const { Command } = require('commander');
const { organize } = require('./organizer');
const { detectProjectMarkers } = require('./guard');
const { loadHistory: loadRunHistory } = require('./history');
const { undo } = require('./undo');
const { suggestName } = require('./suggest');
const pkg = require('../package.json');

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

function isYes(answer) {
  return /^y(es)?$/i.test(answer.trim());
}

/**
 * Wraps readline in a small line queue instead of chained rl.question()
 * calls. Sequential question() calls on a non-TTY stream (piped input, or
 * a user pasting several answers at once) can drop lines that arrive
 * before the next question() attaches its listener — this queues every
 * line as it arrives so nothing is lost regardless of timing.
 */
function createPrompter() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  const queue = [];
  const waiters = [];

  rl.on('line', (line) => {
    if (waiters.length > 0) {
      waiters.shift()(line);
    } else {
      queue.push(line);
    }
  });

  rl.on('close', () => {
    while (waiters.length > 0) {
      waiters.shift()('');
    }
  });

  function ask(promptText) {
    process.stdout.write(promptText);
    if (queue.length > 0) {
      return Promise.resolve(queue.shift());
    }
    return new Promise((resolve) => waiters.push(resolve));
  }

  return { ask, close: () => rl.close() };
}

/**
 * A guided, plain-language walkthrough for people who don't want to learn
 * the flags. Triggered when sortify is run with no arguments at all.
 */
async function runWizard() {
  console.log("Hi! Let's organize a folder together — I'll explain each step.\n");
  const { ask, close } = createPrompter();

  try {
    const folderAnswer = (await ask(`Which folder do you want to organize?\n(press Enter to use the current folder: ${process.cwd()})\n> `)).trim();
    const folderInput = folderAnswer || '.';

    let targetDir;
    try {
      targetDir = resolveExistingDir(folderInput);
    } catch (err) {
      console.log(`\nI couldn't find that folder (${err.message}). Nothing was changed.`);
      return;
    }

    console.log(`\nGot it: ${targetDir}\n`);
    console.log('Should I also look inside its subfolders?');
    console.log('  1) No, just the files sitting directly in this folder (simplest, default)');
    console.log('  2) Yes, one level of subfolders too');
    console.log('  3) Yes, dig through everything, no matter how deep');
    const depthChoice = (await ask('> ')).trim();
    const depth = depthChoice === '2' ? 1 : depthChoice === '3' ? Infinity : 0;

    const excludeAnswer = (await ask("\nAny folders you'd like me to leave alone? (type names separated by commas, or just press Enter for none)\n> ")).trim();
    const exclude = excludeAnswer ? excludeAnswer.split(',').map((s) => s.trim()).filter(Boolean) : [];

    const projectMarkers = detectProjectMarkers(targetDir);
    if (projectMarkers.length > 0) {
      console.log(`\nHeads up: this looks like a project folder (it has a ${projectMarkers[0]}), not a messy pile of files — organizing it could break it.`);
      const proceedAnswer = await ask('Organize it anyway? (y/N)\n> ');
      if (!isYes(proceedAnswer)) {
        console.log('\nOkay, I left it alone. Nothing was changed.');
        return;
      }
    }

    console.log('\nOne moment, let me see what would happen...\n');
    const preview = await organize({ targetDir, exclude, depth, dryRun: true, includeHidden: false, useDefaultExcludes: true });

    if (preview.moves.length === 0) {
      console.log("I didn't find anything that needs organizing here. All done!");
      return;
    }

    const byCategory = new Map();
    for (const move of preview.moves) {
      byCategory.set(move.category, (byCategory.get(move.category) || 0) + 1);
    }
    console.log(`I can organize ${preview.moves.length} file(s) into ${byCategory.size} folder(s):`);
    for (const [category, count] of [...byCategory.entries()].sort()) {
      console.log(`  ${category}: ${count} file(s)`);
    }

    const confirmAnswer = await ask('\nGo ahead and do it now? (y/N)\n> ');
    if (!isYes(confirmAnswer)) {
      console.log('\nNo problem, nothing was changed. Run me again anytime.');
      return;
    }

    const result = await organize({ targetDir, exclude, depth, dryRun: false, includeHidden: false, useDefaultExcludes: true });
    console.log(`\nAll done! I organized ${result.moves.length} file(s).`);
    if (result.run) {
      console.log(`If you change your mind, undo it with: sortify undo --run ${result.run.id} "${folderInput}"`);
    }
  } finally {
    close();
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
      console.error(`Error: ${err.message}`);
      process.exitCode = 1;
      return;
    }

    let depth;
    try {
      depth = parseDepth(options.stage ?? options.depth ?? '0');
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exitCode = 1;
      return;
    }

    const projectMarkers = detectProjectMarkers(targetDir);
    if (projectMarkers.length > 0 && !options.force) {
      console.log(`Skipping: ${targetDir}`);
      console.log(`This looks like a project folder (found: ${projectMarkers.join(', ')}) — it's already organized on its own terms, not a pile of loose files to sort.`);
      console.log('Nothing was changed. Pass --force to organize it anyway, or point sortify at a subfolder instead.');
      return;
    }

    console.log(`${options.dryRun ? '[dry run] ' : ''}Organizing: ${targetDir}`);
    console.log(`Depth (stage): ${depth === Infinity ? 'all' : depth}${options.exclude.length ? `  |  Excluding: ${options.exclude.join(', ')}` : ''}`);

    try {
      const { moves, run } = await organize({
        targetDir,
        exclude: options.exclude,
        depth,
        dryRun: options.dryRun,
        includeHidden: options.includeHidden,
        useDefaultExcludes: options.defaultExclude,
      });

      if (moves.length === 0) {
        console.log('Nothing to organize — no matching files found.');
        return;
      }

      const byCategory = new Map();
      for (const move of moves) {
        byCategory.set(move.category, (byCategory.get(move.category) || 0) + 1);
        if (options.verbose) {
          const verb = options.dryRun ? 'would move' : 'moved';
          console.log(`  ${verb}: ${path.relative(targetDir, move.from)} -> ${path.relative(targetDir, move.to)}`);
        }
      }

      console.log('');
      console.log(`${options.dryRun ? 'Would organize' : 'Organized'} ${moves.length} file(s) into ${byCategory.size} folder(s):`);
      for (const [category, count] of [...byCategory.entries()].sort()) {
        console.log(`  ${category}: ${count}`);
      }
      if (options.dryRun) {
        console.log('\nRun again without --dry-run to apply these changes.');
      } else if (run) {
        console.log(`\nRecorded as run #${run.id}. Undo with: sortify undo --run ${run.id} "${folder}"`);
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
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
      console.error(`Error: ${err.message}`);
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
        console.log(`${options.dryRun ? '[dry run] ' : ''}Run #${entry.id} (${entry.timestamp}):`);
        for (const move of entry.restored) {
          console.log(`  ${options.dryRun ? 'would restore' : 'restored'}: ${path.relative(targetDir, move.to)} -> ${path.relative(targetDir, move.from)}`);
        }
        for (const move of entry.skipped) {
          console.log(`  skipped: ${path.relative(targetDir, move.to)} (${move.reason})`);
        }
        console.log(`  ${entry.restored.length} restored, ${entry.skipped.length} skipped.`);
      }
      if (options.dryRun) {
        console.log('\nRun again without --dry-run to apply this undo.');
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
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
      console.error(`Error: ${err.message}`);
      process.exitCode = 1;
      return;
    }

    const history = await loadRunHistory(targetDir);
    if (history.length === 0) {
      console.log('No recorded runs for this folder.');
      return;
    }

    for (const run of history) {
      const status = run.undone ? `undone at ${run.undoneAt}` : 'active';
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
      console.error(`Error: ${err.message}`);
      process.exitCode = 1;
      return;
    }

    let depth;
    try {
      depth = parseDepth(options.depth);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exitCode = 1;
      return;
    }

    let suggestion;
    try {
      suggestion = await suggestName(targetDir, { depth, apiKey: options.apiKey, offline: options.offline });
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exitCode = 1;
      return;
    }

    if (!suggestion.name) {
      console.log(suggestion.reason);
      return;
    }

    console.log(`Suggested name (${suggestion.mode}): ${suggestion.name}`);
    console.log(suggestion.reason);
    if (suggestion.warning) console.log(`Note: ${suggestion.warning}`);

    if (!options.rename) {
      return;
    }

    const projectMarkers = detectProjectMarkers(targetDir);
    if (projectMarkers.length > 0) {
      console.log(`\nRefusing to rename: this looks like a project folder (found: ${projectMarkers.join(', ')}).`);
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
      const { ask, close } = createPrompter();
      const answer = await ask(`\nRename "${targetDir}" to "${destPath}"? [y/N] `);
      close();
      if (!isYes(answer)) {
        console.log('Rename cancelled.');
        return;
      }
    }

    fs.renameSync(targetDir, destPath);
    console.log(`Renamed to: ${destPath}`);
  });

if (process.argv.slice(2).length === 0) {
  runWizard();
} else {
  program.parse();
}
