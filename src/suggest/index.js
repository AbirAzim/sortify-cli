'use strict';

const { suggestNameHeuristic } = require('./heuristic');
const { suggestNameAI } = require('./ai');

/**
 * Suggests a meaningful name for `targetDir`. Uses the Anthropic API when
 * an API key is available (explicit `apiKey`, or the ANTHROPIC_API_KEY env
 * var) and not disabled via `offline`; otherwise — or if the AI call fails
 * for any reason (no network, bad key, rate limit) — falls back to the
 * offline heuristic so the feature always returns something.
 */
async function suggestName(targetDir, { depth = 1, apiKey, offline = false } = {}) {
  const resolvedKey = offline ? null : apiKey || process.env.ANTHROPIC_API_KEY;

  if (resolvedKey) {
    try {
      return await suggestNameAI(targetDir, { depth, apiKey: resolvedKey });
    } catch (err) {
      const fallback = await suggestNameHeuristic(targetDir, { depth });
      fallback.warning = `AI suggestion failed (${err.message}); used the offline heuristic instead.`;
      return fallback;
    }
  }

  return suggestNameHeuristic(targetDir, { depth });
}

module.exports = { suggestName };
