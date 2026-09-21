'use strict';

const { analyzeFolder } = require('./analyze');
const { readProjectName } = require('./projectName');

function sanitizeName(name) {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/ /g, '_')
    .slice(0, 80);
  return cleaned || 'Untitled_Folder';
}

function toTitleCase(word) {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Finds a shared filename prefix (e.g. "invoice" across invoice-2023-01.pdf,
 * invoice-2023-02.pdf, ...) as long as it actually covers most of the files
 * — a coincidental two-file match isn't a real pattern.
 */
function commonPrefix(names) {
  const stems = names.map((n) => n.replace(/\.[^.]+$/, ''));
  if (stems.length < 2) return null;

  let prefix = stems[0];
  for (const stem of stems.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < stem.length && prefix[i].toLowerCase() === stem[i].toLowerCase()) {
      i += 1;
    }
    prefix = prefix.slice(0, i);
    if (!prefix) break;
  }

  prefix = prefix.replace(/[-_\s0-9]+$/, '');
  if (prefix.length < 3) return null;

  const matching = stems.filter((s) => s.toLowerCase().startsWith(prefix.toLowerCase())).length;
  if (matching / stems.length < 0.6) return null;

  return prefix;
}

function formatDateRange(dateRange) {
  if (!dateRange) return null;
  const { from, to } = dateRange;
  const sameYear = from.getFullYear() === to.getFullYear();
  const sameMonth = sameYear && from.getMonth() === to.getMonth();

  if (sameMonth) {
    return from.toLocaleString('en-US', { month: 'short', year: 'numeric' }).replace(' ', '_');
  }
  if (sameYear) {
    return String(from.getFullYear());
  }
  return `${from.getFullYear()}-${to.getFullYear()}`;
}

/**
 * Offline, no-network name suggestion. Prefers a declared project name
 * (package.json, Cargo.toml, ...) when present, otherwise falls back to a
 * shared filename pattern or the dominant content category, plus a date
 * hint from file modification times.
 */
async function suggestNameHeuristic(targetDir, { depth = 1 } = {}) {
  const analysis = await analyzeFolder(targetDir, { depth });

  if (analysis.projectMarkers.length > 0) {
    const project = readProjectName(targetDir, analysis.projectMarkers);
    if (project) {
      return {
        name: sanitizeName(project.name),
        reason: `Detected a project name in ${project.source}.`,
        mode: 'heuristic',
      };
    }
  }

  if (analysis.fileCount === 0) {
    return { name: null, reason: 'Folder has no files to analyze.', mode: 'heuristic' };
  }

  const prefix = commonPrefix(analysis.names);
  const dominant = [...analysis.categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const dateLabel = formatDateRange(analysis.dateRange);

  const parts = [];
  if (prefix) {
    parts.push(toTitleCase(prefix));
  } else if (dominant) {
    parts.push(dominant[0]);
  }
  if (dateLabel) parts.push(dateLabel);

  const name = sanitizeName(parts.join('_') || 'Sorted_Files');

  const reasonParts = [];
  if (prefix) reasonParts.push(`most filenames share the prefix "${prefix}"`);
  else if (dominant) reasonParts.push(`mostly ${dominant[0]} files (${dominant[1]}/${analysis.fileCount})`);
  if (dateLabel) reasonParts.push(`dated around ${dateLabel}`);

  return {
    name,
    reason: reasonParts.length ? `Based on ${reasonParts.join(' and ')}.` : "Based on the folder's general content.",
    mode: 'heuristic',
  };
}

module.exports = { suggestNameHeuristic, sanitizeName };
