'use strict';

const fs = require('fs');
const path = require('path');
const { getCategory } = require('../categorize');
const { detectProjectMarkers } = require('../guard');
const { collectFiles } = require('../organizer');

/**
 * Gathers cheap, local signals about a folder's contents — file names,
 * category/extension breakdown, mtime range, and project markers — for
 * both the offline heuristic and the AI-powered name suggester to use.
 * Never reads file bytes, only names and stat metadata.
 */
async function analyzeFolder(targetDir, { depth = 1 } = {}) {
  const files = await collectFiles(targetDir, {
    maxDepth: depth,
    excludeNames: new Set(),
    excludePaths: new Set(),
    includeHidden: false,
    skipCategoryFolders: true,
  });

  const categoryCounts = new Map();
  const extensionCounts = new Map();
  const names = [];
  let oldestMtimeMs = Infinity;
  let newestMtimeMs = -Infinity;

  for (const filePath of files) {
    const filename = path.basename(filePath);
    const category = getCategory(filename);
    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);

    const ext = path.extname(filename).slice(1).toLowerCase();
    if (ext) extensionCounts.set(ext, (extensionCounts.get(ext) || 0) + 1);

    names.push(filename);

    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < oldestMtimeMs) oldestMtimeMs = stat.mtimeMs;
      if (stat.mtimeMs > newestMtimeMs) newestMtimeMs = stat.mtimeMs;
    } catch {
      // File disappeared mid-scan — ignore for date-range purposes.
    }
  }

  return {
    targetDir,
    fileCount: files.length,
    categoryCounts,
    extensionCounts,
    names,
    dateRange: files.length ? { from: new Date(oldestMtimeMs), to: new Date(newestMtimeMs) } : null,
    projectMarkers: detectProjectMarkers(targetDir),
  };
}

module.exports = { analyzeFolder };
