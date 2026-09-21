'use strict';

const { analyzeFolder } = require('../analyze');
const { sanitizeName } = require('../heuristic');
const { buildPrompt, parseNameReasonResponse } = require('./promptUtils');

const DEFAULT_MODEL = 'gpt-5.5';

/**
 * AI-powered name suggestion via the OpenAI API (ChatGPT). Only ever
 * called when an API key is available; the caller (suggest/index.js) is
 * responsible for falling back to the offline heuristic on any failure.
 */
async function suggestNameOpenAI(targetDir, { depth = 1, apiKey, model } = {}) {
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey });

  const analysis = await analyzeFolder(targetDir, { depth });
  if (analysis.fileCount === 0) {
    return { name: null, reason: 'Folder has no files to analyze.', mode: 'ai', provider: 'openai' };
  }

  const prompt = buildPrompt(targetDir, analysis);

  const response = await client.responses.create({
    model: model || process.env.OPENAI_MODEL || DEFAULT_MODEL,
    input: prompt,
  });

  const { name, reason } = parseNameReasonResponse(response.output_text);
  return { name: sanitizeName(name), reason, mode: 'ai', provider: 'openai' };
}

module.exports = { suggestNameOpenAI };
