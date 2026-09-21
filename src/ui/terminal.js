'use strict';

/**
 * Whether it's safe to assume the terminal renders Unicode block/braille
 * characters correctly. Always true off Windows (macOS/Linux terminals are
 * overwhelmingly UTF-8 today). On Windows, only true inside a terminal
 * known to handle it well (Windows Terminal, ConEmu, VS Code's integrated
 * terminal, or CI) — plain conhost (classic cmd.exe/PowerShell console)
 * often renders these as "?" or garbled boxes depending on the active code
 * page, so callers should fall back to plain ASCII there.
 */
function supportsUnicode() {
  if (process.platform !== 'win32') return true;
  return Boolean(
    process.env.WT_SESSION || // Windows Terminal
      process.env.ConEmuTask || // ConEmu / Cmder
      process.env.TERM_PROGRAM === 'vscode' ||
      process.env.CI
  );
}

module.exports = { supportsUnicode };
