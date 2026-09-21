'use strict';

const path = require('path');
const fs = require('fs');
const { Command } = require('commander');
const { organize } = require('./organizer');
const { detectProjectMarkers } = require('./guard');
const { loadHistory: loadRunHistory } = require('./history');
const { undo } = require('./undo');
const pkg = require('../package.json');

function resolveExistingDir(folder) {
  const targetDir = path.resolve(process.cwd(), folder);
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
  .description('Organize the files in a folder into meaningfully named subfolders by content type (Images, Documents, Videos, ...).')
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

program.parse();
