'use strict';

// kleur auto-detects TTY/NO_COLOR/FORCE_COLOR and disables codes when
// output isn't a real terminal, so piped/logged output stays clean.
const kleur = require('kleur');

// One color per category so a listing is scannable at a glance.
const CATEGORY_COLORS = {
  Images: kleur.magenta,
  Documents: kleur.blue,
  Videos: kleur.cyan,
  Audio: kleur.green,
  Archives: kleur.yellow,
  Spreadsheets: kleur.green,
  Presentations: kleur.blue,
  Code: kleur.red,
  Executables: kleur.red,
  Fonts: kleur.magenta,
  Others: kleur.grey,
};

function category(name) {
  const colorFn = CATEGORY_COLORS[name] || kleur.white;
  return colorFn(name);
}

module.exports = {
  category,
  success: (s) => kleur.green(s),
  error: (s) => kleur.red(s),
  warn: (s) => kleur.yellow(s),
  info: (s) => kleur.cyan(s),
  dim: (s) => kleur.dim(s),
  bold: (s) => kleur.bold(s),
  heading: (s) => kleur.bold().cyan(s),
};
