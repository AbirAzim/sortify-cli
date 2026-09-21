'use strict';

const colors = require('./colors');

const BAR_WIDTH = 30;

/**
 * A minimal, dependency-free progress bar. Renders nothing when stdout
 * isn't a real terminal (piped output, logs, CI) so it never corrupts
 * non-interactive output.
 */
function createProgressBar(total, label = '') {
  const isTTY = Boolean(process.stdout.isTTY);
  let current = 0;

  function render() {
    if (!isTTY || total === 0) return;
    const ratio = current / total;
    const filled = Math.round(BAR_WIDTH * ratio);
    const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
    const percent = String(Math.round(ratio * 100)).padStart(3, ' ');
    process.stdout.write(`\r${label ? `${label} ` : ''}${colors.info(bar)} ${percent}% (${current}/${total})`);
  }

  return {
    update(value) {
      current = value;
      render();
    },
    increment() {
      current += 1;
      render();
    },
    stop() {
      if (!isTTY || total === 0) return;
      process.stdout.write('\n');
    },
  };
}

module.exports = { createProgressBar };
