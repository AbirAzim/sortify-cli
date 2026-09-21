'use strict';

const fs = require('fs/promises');
const path = require('path');
const { getCategory, isKnownCategoryFolder, DEFAULT_EXCLUDE_DIRS } = require('./categorize');
const { HISTORY_DIR_NAME, recordRun } = require('./history');

/**
 * Walks `dir` up to `maxDepth` levels below `rootDir` and collects the files
 * that should be organized. Depth 0 means only files directly inside `dir`.
 */
async function collectFiles(dir, { maxDepth, currentDepth = 0, excludeNames, excludePaths, includeHidden, skipCategoryFolders }) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // sortify's own undo log — never treat it as organizable content.
    if (entry.name === HISTORY_DIR_NAME) {
      continue;
    }

    if (!includeHidden && entry.name.startsWith('.')) {
      continue;
    }

    if (entry.isDirectory()) {
      if (excludeNames.has(entry.name.toLowerCase()) || excludePaths.has(fullPath)) {
        continue;
      }
      if (skipCategoryFolders && isKnownCategoryFolder(entry.name)) {
        continue;
      }
      if (currentDepth < maxDepth) {
        const nested = await collectFiles(fullPath, {
          maxDepth,
          currentDepth: currentDepth + 1,
          excludeNames,
          excludePaths,
          includeHidden,
          skipCategoryFolders,
        });
        files.push(...nested);
      }
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Picks a non-colliding destination path by appending " (1)", " (2)", ...
 * before the extension if a file with the same name already exists there.
 */
async function resolveCollision(destDir, filename, claimedPaths) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = filename;
  let counter = 1;

  while (true) {
    const candidatePath = path.join(destDir, candidate);
    const alreadyClaimed = claimedPaths.has(candidatePath);
    let existsOnDisk = false;
    if (!alreadyClaimed) {
      try {
        await fs.access(candidatePath);
        existsOnDisk = true;
      } catch {
        existsOnDisk = false;
      }
    }

    if (!alreadyClaimed && !existsOnDisk) {
      claimedPaths.add(candidatePath);
      return candidatePath;
    }
    candidate = `${base} (${counter})${ext}`;
    counter += 1;
  }
}

async function moveFile(sourcePath, destPath) {
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  try {
    await fs.rename(sourcePath, destPath);
  } catch (err) {
    if (err.code === 'EXDEV') {
      // Source and destination are on different filesystems/devices.
      await fs.copyFile(sourcePath, destPath);
      await fs.unlink(sourcePath);
    } else {
      throw err;
    }
  }
}

/**
 * Organizes files under `targetDir` into category subfolders based on
 * content type (by extension).
 *
 * @param {object} options
 * @param {string} options.targetDir - Absolute path to the folder to organize.
 * @param {string[]} options.exclude - Folder names or paths to skip.
 * @param {number} options.depth - How many levels deep to look for files (Infinity for unlimited).
 * @param {boolean} options.dryRun - If true, only plan the moves, don't perform them.
 * @param {boolean} options.includeHidden - If true, include dotfiles.
 * @param {(current: number, total: number) => void} [options.onProgress] - Called after each file is processed.
 * @param {(info: {filePath: string, filename: string, category: string}) => string|null|undefined} [options.folderNameOverride] -
 *   Lets a caller put a file under a different folder name than its raw category (e.g. splitting a
 *   single-category folder into "Images_Jan_2024", "Images_Feb_2024", ...). Falsy return uses the category.
 * @returns {Promise<{moves: Array<{from: string, to: string, category: string, folder: string}>, skipped: number}>}
 */
async function organize({ targetDir, exclude = [], depth = 0, dryRun = false, includeHidden = false, useDefaultExcludes = true, onProgress, folderNameOverride }) {
  const excludeNames = new Set();
  const excludePaths = new Set();

  if (useDefaultExcludes) {
    for (const name of DEFAULT_EXCLUDE_DIRS) {
      excludeNames.add(name.toLowerCase());
    }
  }

  for (const item of exclude) {
    if (item.includes('/') || item.includes(path.sep)) {
      excludePaths.add(path.resolve(targetDir, item));
    } else {
      excludeNames.add(item.toLowerCase());
    }
  }

  const files = await collectFiles(targetDir, {
    maxDepth: depth,
    excludeNames,
    excludePaths,
    includeHidden,
    skipCategoryFolders: true,
  });

  const moves = [];
  const claimedPaths = new Set();

  for (let i = 0; i < files.length; i += 1) {
    const filePath = files[i];
    const filename = path.basename(filePath);
    const category = getCategory(filename);
    const folderName = (folderNameOverride && folderNameOverride({ filePath, filename, category })) || category;
    const destDir = path.join(targetDir, folderName);
    const destPath = await resolveCollision(destDir, filename, claimedPaths);

    moves.push({ from: filePath, to: destPath, category, folder: folderName });

    if (!dryRun) {
      await moveFile(filePath, destPath);
    }

    if (onProgress) onProgress(i + 1, files.length);
  }

  let run = null;
  if (!dryRun) {
    run = await recordRun(targetDir, { depth, exclude, moves });
  }

  return { moves, run };
}

module.exports = { organize, collectFiles, resolveCollision };
