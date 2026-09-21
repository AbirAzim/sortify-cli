'use strict';

const { analyzeFolder } = require('./analyze');
const { sanitizeName } = require('./heuristic');

/**
 * AI-powered name suggestion via the Anthropic API. Only ever called when
 * an API key is available; the caller (suggest/index.js) is responsible
 * for falling back to the offline heuristic on any failure here.
 *
 * Only file names, extension/category counts, and project markers are
 * sent — never file contents.
 */
async function suggestNameAI(targetDir, { depth = 1, apiKey } = {}) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();

  const analysis = await analyzeFolder(targetDir, { depth });
  if (analysis.fileCount === 0) {
    return { name: null, reason: 'Folder has no files to analyze.', mode: 'ai' };
  }

  const categorySummary = [...analysis.categoryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, count]) => `${cat}: ${count}`)
    .join(', ');

  const sampleNames = analysis.names.slice(0, 60).join('\n');

  const prompt = [
    `Folder path: ${targetDir}`,
    `File count: ${analysis.fileCount}`,
    `Category breakdown: ${categorySummary}`,
    analysis.projectMarkers.length ? `Project markers found: ${analysis.projectMarkers.join(', ')}` : null,
    '',
    'Sample of file names in this folder (may be truncated):',
    sampleNames,
    '',
    'Suggest a short, meaningful, filesystem-safe folder name (letters, numbers, spaces, hyphens, underscores only, no path separators) that describes what this folder actually contains.',
    'Respond in exactly this format and nothing else:',
    'NAME: <suggested name>',
    'REASON: <one sentence>',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 512,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  const nameMatch = text.match(/NAME:\s*(.+)/i);
  const reasonMatch = text.match(/REASON:\s*(.+)/i);

  if (!nameMatch) {
    throw new Error('AI response did not include a NAME line.');
  }

  return {
    name: sanitizeName(nameMatch[1].trim()),
    reason: reasonMatch ? reasonMatch[1].trim() : 'Suggested by AI based on folder content.',
    mode: 'ai',
  };
}

module.exports = { suggestNameAI };
