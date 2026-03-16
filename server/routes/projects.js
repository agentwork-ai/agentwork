const express = require('express');
const router = express.Router();
const { db, uuidv4 } = require('../db');
const { generateProjectDoc } = require('../services/project-doc');
const fs = require('fs');
const path = require('path');

// Get all projects
router.get('/', (req, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
  res.json(projects);
});

// Get single project
router.get('/:id', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

// Create project
router.post('/', (req, res) => {
  const { name, description, path: projectPath, ignore_patterns, default_agent_id } = req.body;

  if (!name || !projectPath) {
    return res.status(400).json({ error: 'Name and path are required' });
  }

  if (!fs.existsSync(projectPath)) {
    return res.status(400).json({ error: 'Path does not exist' });
  }

  const id = uuidv4();
  db.prepare(
    'INSERT INTO projects (id, name, description, path, ignore_patterns, default_agent_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, name, description || '', projectPath, ignore_patterns || 'node_modules,.git,dist,build,.next', default_agent_id || null);

  // Auto-generate PROJECT.md
  try {
    generateProjectDoc(projectPath, name, description);
  } catch (err) {
    console.error('[Projects] Failed to generate PROJECT.md:', err.message);
  }

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  const io = req.app.get('io');
  if (io) io.emit('project:created', project);

  res.status(201).json(project);
});

// Update project
router.put('/:id', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { name, description, path: projectPath, ignore_patterns, default_agent_id } = req.body;

  db.prepare(
    'UPDATE projects SET name = ?, description = ?, path = ?, ignore_patterns = ?, default_agent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(
    name || project.name,
    description !== undefined ? description : project.description,
    projectPath || project.path,
    ignore_patterns !== undefined ? ignore_patterns : project.ignore_patterns,
    default_agent_id !== undefined ? default_agent_id : project.default_agent_id,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  const io = req.app.get('io');
  if (io) io.emit('project:updated', updated);

  res.json(updated);
});

// Delete project
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  const io = req.app.get('io');
  if (io) io.emit('project:deleted', { id: req.params.id });
  res.json({ success: true });
});

// Get project health score
router.get('/:id/health', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const pid = req.params.id;
  const total = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE project_id = ?").get(pid).c;
  const done = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE project_id = ? AND status = 'done'").get(pid).c;
  const blocked = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE project_id = ? AND status = 'blocked'").get(pid).c;
  const doing = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE project_id = ? AND status = 'doing'").get(pid).c;

  // Completion rate (0-40 points)
  const completionRate = total > 0 ? done / total : 0;
  const completionScore = Math.round(completionRate * 40);

  // Blocked ratio penalty (0-20 points, inverted)
  const blockedRate = total > 0 ? blocked / total : 0;
  const blockedScore = Math.round((1 - blockedRate) * 20);

  // Recent activity (0-20 points)
  const recentTasks = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE project_id = ? AND updated_at >= date('now', '-7 days')").get(pid).c;
  const activityScore = Math.min(20, recentTasks * 4);

  // Has agents assigned (0-10 points)
  const agentCount = db.prepare("SELECT COUNT(DISTINCT agent_id) as c FROM tasks WHERE project_id = ? AND agent_id IS NOT NULL").get(pid).c;
  const agentScore = Math.min(10, agentCount * 5);

  // Has PROJECT.md (0-10 points)
  const hasDoc = fs.existsSync(path.join(project.path, 'PROJECT.md')) ? 10 : 0;

  const score = Math.min(100, completionScore + blockedScore + activityScore + agentScore + hasDoc);
  const grade = score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : score >= 20 ? 'D' : 'F';

  res.json({
    score, grade, total, done, blocked, doing,
    breakdown: { completionScore, blockedScore, activityScore, agentScore, docScore: hasDoc },
  });
});

// Regenerate PROJECT.md
router.post('/:id/regenerate-doc', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  try {
    generateProjectDoc(project.path, project.name, project.description);
    res.json({ success: true, message: 'PROJECT.md regenerated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search files in project
router.get('/:id/search', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const query = (req.query.q || '').trim().toLowerCase();
  if (!query) return res.json([]);

  const searchContent = req.query.content === 'true';
  const ignorePatterns = (project.ignore_patterns || '').split(',').map((p) => p.trim()).filter(Boolean);
  const limit = 50;
  const results = [];

  function shouldIgnore(name) {
    return ignorePatterns.some((p) => name === p || name.startsWith('.'));
  }

  function searchDir(dirPath, relativePath) {
    if (results.length >= limit) return;

    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= limit) return;
      if (shouldIgnore(entry.name)) continue;

      const fullPath = path.join(dirPath, entry.name);
      const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        // Check if directory name matches
        if (entry.name.toLowerCase().includes(query)) {
          results.push({ path: fullPath, relativePath: relPath, type: 'directory', match: 'filename' });
        }
        searchDir(fullPath, relPath);
      } else {
        // Check filename match
        if (entry.name.toLowerCase().includes(query)) {
          results.push({ path: fullPath, relativePath: relPath, type: 'file', match: 'filename' });
        } else if (searchContent) {
          // Check file content match for text files
          try {
            const stats = fs.statSync(fullPath);
            if (stats.size > 512 * 1024) continue; // skip files > 512KB
            const content = fs.readFileSync(fullPath, 'utf-8');
            if (content.toLowerCase().includes(query)) {
              // Extract a snippet around the match
              const idx = content.toLowerCase().indexOf(query);
              const start = Math.max(0, idx - 40);
              const end = Math.min(content.length, idx + query.length + 40);
              const snippet = (start > 0 ? '...' : '') + content.slice(start, end).replace(/\n/g, ' ') + (end < content.length ? '...' : '');
              results.push({ path: fullPath, relativePath: relPath, type: 'file', match: 'content', snippet });
            }
          } catch {
            // Binary file or read error, skip
          }
        }
      }
    }
  }

  try {
    searchDir(project.path, '');
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get project file tree
router.get('/:id/files', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const ignorePatterns = (project.ignore_patterns || '').split(',').map((p) => p.trim()).filter(Boolean);
  const maxDepth = parseInt(req.query.depth || '3');

  try {
    const tree = buildFileTree(project.path, ignorePatterns, 0, maxDepth);
    res.json(tree);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function buildFileTree(dirPath, ignorePatterns, depth, maxDepth) {
  if (depth >= maxDepth) return [];

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const result = [];

  for (const entry of entries) {
    if (ignorePatterns.some((p) => entry.name === p || entry.name.startsWith('.'))) continue;

    const fullPath = path.join(dirPath, entry.name);
    const node = {
      name: entry.name,
      path: fullPath,
      type: entry.isDirectory() ? 'directory' : 'file',
    };

    if (entry.isDirectory()) {
      node.children = buildFileTree(fullPath, ignorePatterns, depth + 1, maxDepth);
    } else {
      const stats = fs.statSync(fullPath);
      node.size = stats.size;
    }

    result.push(node);
  }

  return result.sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name);
    return a.type === 'directory' ? -1 : 1;
  });
}

module.exports = router;
