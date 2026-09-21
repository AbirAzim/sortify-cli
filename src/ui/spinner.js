'use strict';

const colors = require('./colors');

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Indeterminate spinner for waiting on something without a known duration
 * (network calls, scanning a large tree). Falls back to a single plain
 * line — no animation — when stdout isn't a real terminal.
 */
function createSpinner(label) {
  const isTTY = Boolean(process.stdout.isTTY);

  if (!isTTY) {
    console.log(label);
    return {
      stop(finalMessage) {
        if (finalMessage) console.log(finalMessage);
      },
    };
  }

  let frame = 0;
  process.stdout.write(`${FRAMES[0]} ${label}`);
  const interval = setInterval(() => {
    frame = (frame + 1) % FRAMES.length;
    process.stdout.write(`\r${colors.info(FRAMES[frame])} ${label}`);
  }, 80);

  return {
    stop(finalMessage) {
      clearInterval(interval);
      process.stdout.write(`\r${' '.repeat(label.length + 2)}\r`);
      if (finalMessage) console.log(finalMessage);
    },
  };
}

module.exports = { createSpinner };
