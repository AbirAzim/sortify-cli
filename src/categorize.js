'use strict';

// Maps a human-meaningful category folder name to the file extensions
// (without the leading dot, lowercase) that belong in it.
const CATEGORY_MAP = {
  Images: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'heic', 'heif', 'tiff', 'tif', 'ico', 'raw', 'psd', 'ai'],
  Videos: ['mp4', 'mov', 'avi', 'mkv', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', '3gp'],
  Audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'aiff', 'opus'],
  Documents: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'md', 'tex', 'pages', 'epub'],
  Spreadsheets: ['xls', 'xlsx', 'csv', 'ods', 'tsv', 'numbers'],
  Presentations: ['ppt', 'pptx', 'odp', 'key'],
  Archives: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso'],
  Code: ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rb', 'php', 'html', 'css', 'scss', 'json', 'yml', 'yaml', 'sh', 'rs', 'swift', 'kt', 'sql'],
  Executables: ['exe', 'dmg', 'pkg', 'msi', 'deb', 'rpm', 'appimage', 'apk'],
  Fonts: ['ttf', 'otf', 'woff', 'woff2'],
};

const DEFAULT_CATEGORY = 'Others';

// Folders that are always skipped, even without an explicit --exclude, since
// sorting their contents by extension would break a project rather than
// declutter it. Overridable with --no-default-exclude.
const DEFAULT_EXCLUDE_DIRS = [
  '.git', '.hg', '.svn',
  'node_modules', '.venv', 'venv', '__pycache__',
  'dist', 'build', '.next', 'target', 'vendor',
];

// Reverse lookup: extension -> category, built once.
const EXT_TO_CATEGORY = new Map();
for (const [category, extensions] of Object.entries(CATEGORY_MAP)) {
  for (const ext of extensions) {
    EXT_TO_CATEGORY.set(ext, category);
  }
}

// All category names the tool itself creates/recognizes. Used to avoid
// re-organizing files that already live inside a category folder from a
// previous run.
const KNOWN_CATEGORY_NAMES = new Set(
  [...Object.keys(CATEGORY_MAP), DEFAULT_CATEGORY].map((name) => name.toLowerCase())
);

function getCategory(filename) {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) {
    return DEFAULT_CATEGORY;
  }
  const ext = filename.slice(dot + 1).toLowerCase();
  return EXT_TO_CATEGORY.get(ext) || DEFAULT_CATEGORY;
}

function isKnownCategoryFolder(name) {
  return KNOWN_CATEGORY_NAMES.has(name.toLowerCase());
}

module.exports = { getCategory, isKnownCategoryFolder, DEFAULT_CATEGORY, CATEGORY_MAP, DEFAULT_EXCLUDE_DIRS };
