'use strict';

const colors = require('./colors');
const { supportsUnicode } = require('./terminal');

const UNICODE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const ASCII_FRAMES = ['|', '/', '-', '\\'];

/**
 * Indeterminate spinner for waiting on something without a known duration
 * (network calls, scanning a large tree). Falls back to a single plain
 * line — no animation — when stdout isn't a real terminal, and to plain
 * ASCII frames on a classic Windows console that may not render Braille
 * spinner characters.
 */
function createSpinner(label) {
  const isTTY = Boolean(process.stdout.isTTY);
  const FRAMES = supportsUnicode() ? UNICODE_FRAMES : ASCII_FRAMES;

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
