'use strict';

const { analyzeFolder } = require('../analyze');
const { sanitizeName } = require('../heuristic');
const { buildPrompt, parseNameReasonResponse } = require('./promptUtils');

const DEFAULT_MODEL = 'claude-opus-5';

/**
 * AI-powered name suggestion via the Anthropic API. Only ever called when
 * an API key is available; the caller (suggest/index.js) is responsible
 * for falling back to the offline heuristic on any failure here.
 */
async function suggestNameAnthropic(targetDir, { depth = 1, apiKey, model } = {}) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();

  const analysis = await analyzeFolder(targetDir, { depth });
  if (analysis.fileCount === 0) {
    return { name: null, reason: 'Folder has no files to analyze.', mode: 'ai', provider: 'anthropic' };
  }

  const prompt = buildPrompt(targetDir, analysis);

  const response = await client.messages.create({
    model: model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
    max_tokens: 512,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  const { name, reason } = parseNameReasonResponse(text);
  return { name: sanitizeName(name), reason, mode: 'ai', provider: 'anthropic' };
}

module.exports = { suggestNameAnthropic };
