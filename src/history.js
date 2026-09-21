'use strict';

const fs = require('fs/promises');
const path = require('path');

// Metadata folder created inside the organized directory itself, so the
// undo log travels with the folder it describes rather than living in some
// central place that breaks if the folder is moved or copied.
const HISTORY_DIR_NAME = '.sortify';
const HISTORY_FILE_NAME = 'history.json';

function historyDir(targetDir) {
  return path.join(targetDir, HISTORY_DIR_NAME);
}

function historyFilePath(targetDir) {
  return path.join(historyDir(targetDir), HISTORY_FILE_NAME);
}

async function loadHistory(targetDir) {
  try {
    const raw = await fs.readFile(historyFilePath(targetDir), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function saveHistory(targetDir, history) {
  await fs.mkdir(historyDir(targetDir), { recursive: true });
  await fs.writeFile(historyFilePath(targetDir), JSON.stringify(history, null, 2), 'utf8');
}

/**
 * Appends a completed (non-dry-run) run to this folder's history log.
 * Run ids are small sequential integers, scoped to this folder, so they're
 * easy to type back with `sortify undo --run <id>`.
 */
async function recordRun(targetDir, { depth, exclude, moves }) {
  if (!moves || moves.length === 0) return null;

  const history = await loadHistory(targetDir);
  const run = {
    id: history.length + 1,
    timestamp: new Date().toISOString(),
    depth: depth === Infinity ? 'all' : depth,
    exclude,
    moves,
    undone: false,
  };
  history.push(run);
  await saveHistory(targetDir, history);
  return run;
}

module.exports = { HISTORY_DIR_NAME, loadHistory, saveHistory, recordRun };
