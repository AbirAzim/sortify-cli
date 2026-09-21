'use strict';

const fs = require('fs/promises');
const path = require('path');
const { loadHistory, saveHistory } = require('./history');

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function moveBack(from, to) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.rename(from, to);
  } catch (err) {
    if (err.code === 'EXDEV') {
      await fs.copyFile(from, to);
      await fs.unlink(from);
    } else {
      throw err;
    }
  }
}

// Best-effort tidy-up: removes the folders these specific moves were sorted
// into, if undoing left them empty. Uses `move.folder` (the actual
// destination folder name — may differ from the raw category when a run
// used the combine/split naming) rather than a static category list, so
// it also cleans up folders like "Images_Jan_2024" or "Holiday_2024".
// Falls back to `move.category` for older history entries recorded before
// `folder` existed. Never touches a folder that still has something in it.
async function removeEmptyFolders(targetDir, moves) {
  const folderNames = new Set(moves.map((m) => m.folder || m.category));
  for (const name of folderNames) {
    const dirPath = path.join(targetDir, name);
    try {
      const entries = await fs.readdir(dirPath);
      if (entries.length === 0) {
        await fs.rmdir(dirPath);
      }
    } catch {
      // Doesn't exist, or isn't a plain empty dir — leave it alone.
    }
  }
}

function selectRuns(history, { runId, all }) {
  const isUndoable = (r) => !r.undone;

  if (runId !== undefined) {
    const run = history.find((r) => r.id === runId);
    if (!run) throw new Error(`No recorded run found with id ${runId}. Use "sortify history" to list runs.`);
    if (run.undone) throw new Error(`Run ${runId} was already undone at ${run.undoneAt}.`);
    return [run];
  }

  if (all) {
    return history.filter(isUndoable).slice().reverse();
  }

  const last = [...history].reverse().find(isUndoable);
  return last ? [last] : [];
}

/**
 * Reverses one or more previously recorded sortify runs for `targetDir`.
 * A move is only restored if the sorted file is still where sortify left it
 * and nothing new now occupies the original path — anything else is
 * reported as skipped rather than silently overwritten.
 */
async function undo({ targetDir, runId, all = false, dryRun = false }) {
  const history = await loadHistory(targetDir);
  const runs = selectRuns(history, { runId, all });

  const report = [];
  const touchedMoves = [];

  for (const run of runs) {
    const restored = [];
    const skipped = [];

    for (const move of [...run.moves].reverse()) {
      const sortedFileExists = await pathExists(move.to);
      const originalPathTaken = await pathExists(move.from);

      if (!sortedFileExists) {
        skipped.push({ ...move, reason: 'file is no longer at its sorted location (moved or deleted since)' });
        continue;
      }
      if (originalPathTaken) {
        skipped.push({ ...move, reason: 'a different file now exists at the original location' });
        continue;
      }
      if (!dryRun) {
        await moveBack(move.to, move.from);
      }
      restored.push(move);
    }

    if (!dryRun) {
      run.undone = true;
      run.undoneAt = new Date().toISOString();
    }

    touchedMoves.push(...run.moves);
    report.push({ id: run.id, timestamp: run.timestamp, restored, skipped });
  }

  if (!dryRun && runs.length > 0) {
    await saveHistory(targetDir, history);
    await removeEmptyFolders(targetDir, touchedMoves);
  }

  return report;
}

module.exports = { undo };
