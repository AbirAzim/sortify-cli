'use strict';

/**
 * The same prompt text works across providers — only file names, extension/
 * category counts, and project markers are sent, never file contents.
 */
function buildPrompt(targetDir, analysis) {
  const categorySummary = [...analysis.categoryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, count]) => `${cat}: ${count}`)
    .join(', ');

  const sampleNames = analysis.names.slice(0, 60).join('\n');

  return [
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
}

function parseNameReasonResponse(text) {
  const nameMatch = (text || '').match(/NAME:\s*(.+)/i);
  const reasonMatch = (text || '').match(/REASON:\s*(.+)/i);

  if (!nameMatch) {
    throw new Error('AI response did not include a NAME line.');
  }

  return {
    name: nameMatch[1].trim(),
    reason: reasonMatch ? reasonMatch[1].trim() : 'Suggested by AI based on folder content.',
  };
}

module.exports = { buildPrompt, parseNameReasonResponse };
