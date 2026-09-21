'use strict';

const fs = require('fs');

// Presence of any of these at the top level of a folder is a strong signal
// that it's a source project (already organized on its own terms), not a
// messy pile of files that needs sorting by content type.
const PROJECT_MARKER_FILES = [
  'package.json',
  'pyproject.toml',
  'setup.py',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Gemfile',
  'composer.json',
  'CMakeLists.txt',
];

const PROJECT_MARKER_DIRS = ['.git', '.hg', '.svn'];

const PROJECT_MARKER_EXTENSIONS = /\.(csproj|sln|xcodeproj)$/i;

/**
 * Looks only at the immediate contents of `dir` (no recursion) for signs
 * that it's a project root. Returns the list of markers found, empty if none.
 */
function detectProjectMarkers(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const found = [];
  for (const entry of entries) {
    if (entry.isFile() && PROJECT_MARKER_FILES.includes(entry.name)) {
      found.push(entry.name);
    } else if (entry.isDirectory() && PROJECT_MARKER_DIRS.includes(entry.name)) {
      found.push(entry.name);
    } else if (PROJECT_MARKER_EXTENSIONS.test(entry.name)) {
      found.push(entry.name);
    }
  }
  return found;
}

module.exports = { detectProjectMarkers };
