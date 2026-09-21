'use strict';

const { analyzeFolder } = require('./analyze');
const { readProjectName } = require('./projectName');

// Windows won't create a folder with one of these names (case-insensitive),
// with or without an extension — reserved for legacy device names.
const WINDOWS_RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

function sanitizeName(name) {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '') // Windows-reserved path characters
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/ /g, '_')
    .replace(/[.\s]+$/, '') // Windows disallows a trailing dot or space
    .slice(0, 80);

  if (!cleaned) return 'Untitled_Folder';
  if (WINDOWS_RESERVED_NAMES.has(cleaned.toLowerCase())) return `${cleaned}_folder`;
  return cleaned;
}

function toTitleCase(word) {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

// Default camera/screenshot/app-generated prefixes carry no real
// information beyond "this is a photo/screenshot" — the category already
// says that, so a name built from one of these (e.g. "Img_Mar_2024") isn't
// actually more descriptive than "Images". Fall back to category+date
// instead when the shared prefix is one of these.
const GENERIC_PREFIXES = new Set([
  'img', 'image', 'images', 'dsc', 'dscn', 'photo', 'photos', 'pic', 'pics',
  'picture', 'pictures', 'screenshot', 'screenshots', 'screen_shot', 'shot',
  'untitled', 'file', 'files', 'document', 'documents', 'doc', 'docs',
  'video', 'videos', 'vid', 'clip', 'clips', 'mov', 'audio', 'track', 'tracks',
  'recording', 'recordings', 'rec', 'scan', 'scans', 'copy',
]);

/**
 * Finds a shared filename prefix (e.g. "invoice" across invoice-2023-01.pdf,
 * invoice-2023-02.pdf, ...) as long as it actually covers most of the files
 * — a coincidental two-file match isn't a real pattern — and isn't just a
 * generic camera/app-generated prefix like "IMG" or "Screenshot".
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
  if (GENERIC_PREFIXES.has(prefix.toLowerCase())) return null;

  const matching = stems.filter((s) => s.toLowerCase().startsWith(prefix.toLowerCase())).length;
  if (matching / stems.length < 0.6) return null;

  return prefix;
}

/**
 * Reduces a filename to its "stem": no extension, and no trailing
 * date/counter digits (invoice_2024_01.pdf -> "invoice_2024", further
 * trimmed of trailing separators+digits again isn't needed since the loop
 * below strips only one numeric run — callers that want the bare word use
 * this alongside their own numeric-suffix stripping where relevant).
 */
function extractStem(filename) {
  let stem = filename.replace(/\.[^.]+$/, '');
  stem = stem.replace(/[-_\s]*\d{1,8}$/, '');
  stem = stem.replace(/[-_\s]+$/, '');
  return stem.toLowerCase();
}

/**
 * Clusters filenames by shared stem (e.g. "invoice" across invoice_01.pdf,
 * invoice_02.pdf; "receipt" across receipt_01.pdf, receipt_02.pdf), for
 * folders that contain more than one distinct naming pattern rather than
 * a single one spanning every file. Drops generic stems (IMG, Screenshot,
 * ...) and any stem that only matches once (not a real pattern).
 */
function groupByFilenamePattern(names) {
  const counts = new Map();
  for (const name of names) {
    const stem = extractStem(name);
    if (stem.length < 3 || GENERIC_PREFIXES.has(stem)) continue;
    counts.set(stem, (counts.get(stem) || 0) + 1);
  }
  for (const [stem, count] of [...counts]) {
    if (count < 2) counts.delete(stem);
  }
  return counts;
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
 * Pure, in-memory version of the heuristic: given filenames, a category
 * breakdown, and a date range (no disk access), suggests a name plus the
 * reasoning behind it. Shared by suggestNameHeuristic (which gathers these
 * from a live folder) and callers that already have this data in hand —
 * e.g. `organize()`'s move list, to flag a category folder that ended up
 * holding everything under one generic name like "Images".
 */
function suggestNameFromFiles(names, categoryCounts, dateRange) {
  if (names.length === 0) {
    return { name: null, reason: 'No files to analyze.', mode: 'heuristic' };
  }

  const prefix = commonPrefix(names);
  const dominant = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const dateLabel = formatDateRange(dateRange);

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
  else if (dominant) reasonParts.push(`mostly ${dominant[0]} files (${dominant[1]}/${names.length})`);
  if (dateLabel) reasonParts.push(`dated around ${dateLabel}`);

  return {
    name,
    reason: reasonParts.length ? `Based on ${reasonParts.join(' and ')}.` : "Based on the folder's general content.",
    mode: 'heuristic',
  };
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

  return suggestNameFromFiles(analysis.names, analysis.categoryCounts, analysis.dateRange);
}

module.exports = { suggestNameHeuristic, suggestNameFromFiles, sanitizeName, toTitleCase, extractStem, groupByFilenamePattern };
