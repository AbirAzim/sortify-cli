'use strict';

const { suggestNameHeuristic } = require('./heuristic');
const { suggestNameAnthropic } = require('./providers/anthropic');
const { suggestNameOpenAI } = require('./providers/openai');
const { suggestNameGemini } = require('./providers/gemini');

// Auto-detection checks these in order and uses the first one that's set,
// so having more than one key in your environment doesn't cause ambiguity.
const PROVIDERS = {
  anthropic: { envVar: 'ANTHROPIC_API_KEY', label: 'Claude', run: suggestNameAnthropic },
  openai: { envVar: 'OPENAI_API_KEY', label: 'ChatGPT', run: suggestNameOpenAI },
  gemini: { envVar: 'GEMINI_API_KEY', label: 'Gemini', run: suggestNameGemini },
};
const PROVIDER_PRIORITY = ['anthropic', 'openai', 'gemini'];

/**
 * Figures out which AI provider (if any) to use:
 * - An explicit `provider` always wins; its key comes from `apiKey` or that
 *   provider's own env var (e.g. GEMINI_API_KEY).
 * - An explicit `apiKey` with no `provider` is assumed to be Anthropic, for
 *   backwards compatibility with the original --api-key flag.
 * - Otherwise, auto-detects from whichever provider's env var is set first.
 * Returns null if nothing usable was found (falls back to offline).
 */
function resolveProvider({ provider, apiKey }) {
  if (provider) {
    const entry = PROVIDERS[provider];
    if (!entry) {
      throw new Error(`Unknown AI provider "${provider}". Supported: ${Object.keys(PROVIDERS).join(', ')}.`);
    }
    const key = apiKey || process.env[entry.envVar];
    return key ? { ...entry, apiKey: key } : null;
  }

  if (apiKey) {
    return { ...PROVIDERS.anthropic, apiKey };
  }

  for (const name of PROVIDER_PRIORITY) {
    const entry = PROVIDERS[name];
    const key = process.env[entry.envVar];
    if (key) return { ...entry, apiKey: key };
  }

  return null;
}

/**
 * Suggests a meaningful name for `targetDir`. Uses whichever AI provider
 * resolveProvider() finds (Claude, ChatGPT, or Gemini) when a key is
 * available and not disabled via `offline`; otherwise — or if the AI call
 * fails for any reason (no network, bad key, rate limit) — falls back to
 * the offline heuristic so the feature always returns something.
 */
async function suggestName(targetDir, { depth = 1, apiKey, provider, offline = false, model } = {}) {
  const resolved = offline ? null : resolveProvider({ provider, apiKey });

  if (resolved) {
    try {
      return await resolved.run(targetDir, { depth, apiKey: resolved.apiKey, model });
    } catch (err) {
      const fallback = await suggestNameHeuristic(targetDir, { depth });
      fallback.warning = `${resolved.label} suggestion failed (${err.message}); used the offline heuristic instead.`;
      return fallback;
    }
  }

  return suggestNameHeuristic(targetDir, { depth });
}

module.exports = { suggestName, PROVIDERS };
