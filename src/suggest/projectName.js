'use strict';

const fs = require('fs');
const path = require('path');

function safeRead(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

/**
 * If the folder is a known project type, pulls its declared name straight
 * from the manifest instead of guessing from file names.
 */
function readProjectName(targetDir, markers) {
  const has = (name) => markers.includes(name);

  if (has('package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf8'));
      if (pkg.name) return { name: pkg.name, source: 'package.json' };
    } catch {
      // Malformed package.json — fall through to other markers.
    }
  }

  if (has('Cargo.toml')) {
    const match = safeRead(path.join(targetDir, 'Cargo.toml'))?.match(/^\s*name\s*=\s*"([^"]+)"/m);
    if (match) return { name: match[1], source: 'Cargo.toml' };
  }

  if (has('go.mod')) {
    const match = safeRead(path.join(targetDir, 'go.mod'))?.match(/^module\s+(.+)$/m);
    if (match) return { name: path.basename(match[1].trim()), source: 'go.mod' };
  }

  if (has('pyproject.toml')) {
    const match = safeRead(path.join(targetDir, 'pyproject.toml'))?.match(/^\s*name\s*=\s*"([^"]+)"/m);
    if (match) return { name: match[1], source: 'pyproject.toml' };
  }

  if (has('composer.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(targetDir, 'composer.json'), 'utf8'));
      if (pkg.name) return { name: pkg.name.split('/').pop(), source: 'composer.json' };
    } catch {
      // Malformed composer.json — fall through.
    }
  }

  const readme = safeRead(path.join(targetDir, 'README.md'));
  if (readme) {
    const heading = readme.match(/^#\s+(.+)$/m);
    if (heading) return { name: heading[1].trim(), source: 'README.md' };
  }

  return null;
}

module.exports = { readProjectName };
