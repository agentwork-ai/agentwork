/**
 * Retrieval-Augmented Generation (RAG) Service
 * Simple keyword-based file retrieval for project context.
 * Uses TF-IDF-like scoring without external dependencies.
 *
 * For production use with vector embeddings, install:
 *   npm install @xenova/transformers
 */
const fs = require('fs');
const path = require('path');

const fileIndexCache = new Map(); // projectPath → { files, timestamp }
const INDEX_TTL = 300000; // 5 minutes

function getIgnorePatterns(project) {
  return (project.ignore_patterns || 'node_modules,.git,dist,build,.next')
    .split(',').map((p) => p.trim()).filter(Boolean);
}

/**
 * Index all text files in a project directory.
 */
function indexProject(projectPath, ignorePatterns) {
  const cached = fileIndexCache.get(projectPath);
  if (cached && Date.now() - cached.timestamp < INDEX_TTL) return cached.files;

  const files = [];
  const TEXT_EXTS = new Set(['.js', '.ts', '.jsx', '.tsx', '.py', '.rb', '.go', '.rs', '.java',
    '.c', '.cpp', '.h', '.css', '.scss', '.html', '.json', '.md', '.txt', '.yaml', '.yml',
    '.toml', '.xml', '.sql', '.sh', '.env', '.cfg', '.ini']);

  function walk(dir, depth) {
    if (depth > 5) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (ignorePatterns.some((p) => entry.name === p || entry.name.startsWith('.'))) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (TEXT_EXTS.has(path.extname(entry.name).toLowerCase())) {
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size > 100 * 1024) continue; // skip files > 100KB
            const content = fs.readFileSync(fullPath, 'utf8');
            const words = content.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
            files.push({
              path: fullPath,
              relativePath: path.relative(projectPath, fullPath),
              words: new Set(words),
              size: stat.size,
              preview: content.slice(0, 200),
            });
          } catch {}
        }
      }
    } catch {}
  }

  walk(projectPath, 0);
  fileIndexCache.set(projectPath, { files, timestamp: Date.now() });
  return files;
}

/**
 * Search project files by query, returning most relevant files.
 * Uses simple keyword matching with TF-IDF-like scoring.
 */
function searchProject(project, query, maxResults = 10) {
  const ignorePatterns = getIgnorePatterns(project);
  const files = indexProject(project.path, ignorePatterns);
  const queryWords = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  if (queryWords.length === 0) return [];

  const scored = files.map((file) => {
    let score = 0;
    for (const qw of queryWords) {
      if (file.words.has(qw)) score += 1;
      if (file.relativePath.toLowerCase().includes(qw)) score += 3;
    }
    return { ...file, score, words: undefined };
  }).filter((f) => f.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults).map((f) => ({
    path: f.relativePath,
    score: f.score,
    preview: f.preview,
    size: f.size,
  }));
}

/**
 * Build context from the most relevant files for a task description.
 */
function buildRAGContext(project, taskDescription, maxFiles = 5, maxChars = 10000) {
  const results = searchProject(project, taskDescription, maxFiles);
  if (results.length === 0) return '';

  let context = '## Relevant Project Files (auto-retrieved)\n\n';
  let totalChars = 0;

  for (const result of results) {
    const fullPath = path.join(project.path, result.path);
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const snippet = content.slice(0, Math.min(content.length, maxChars - totalChars));
      context += `### ${result.path}\n\`\`\`\n${snippet}\n\`\`\`\n\n`;
      totalChars += snippet.length;
      if (totalChars >= maxChars) break;
    } catch {}
  }

  return context;
}

module.exports = { searchProject, buildRAGContext, indexProject };
