'use strict';

const { analyzeFolder } = require('../analyze');
const { sanitizeName } = require('../heuristic');
const { buildPrompt, parseNameReasonResponse } = require('./promptUtils');

// A floating alias that Google keeps pointed at their current fast model,
// so this doesn't go stale the way a dated snapshot name would.
const DEFAULT_MODEL = 'gemini-flash-latest';

/**
 * AI-powered name suggestion via the Google Gemini API. Only ever called
 * when an API key is available; the caller (suggest/index.js) is
 * responsible for falling back to the offline heuristic on any failure.
 */
async function suggestNameGemini(targetDir, { depth = 1, apiKey, model } = {}) {
  const { GoogleGenAI } = require('@google/genai');
  const client = new GoogleGenAI({ apiKey });

  const analysis = await analyzeFolder(targetDir, { depth });
  if (analysis.fileCount === 0) {
    return { name: null, reason: 'Folder has no files to analyze.', mode: 'ai', provider: 'gemini' };
  }

  const prompt = buildPrompt(targetDir, analysis);

  const response = await client.models.generateContent({
    model: model || process.env.GEMINI_MODEL || DEFAULT_MODEL,
    contents: prompt,
  });

  const { name, reason } = parseNameReasonResponse(response.text);
  return { name: sanitizeName(name), reason, mode: 'ai', provider: 'gemini' };
}

module.exports = { suggestNameGemini };
