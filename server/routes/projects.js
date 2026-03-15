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
  const { name, description, path: projectPath, ignore_patterns } = req.body;

  if (!name || !projectPath) {
    return res.status(400).json({ error: 'Name and path are required' });
  }

  if (!fs.existsSync(projectPath)) {
    return res.status(400).json({ error: 'Path does not exist' });
  }

  const id = uuidv4();
  db.prepare(
    'INSERT INTO projects (id, name, description, path, ignore_patterns) VALUES (?, ?, ?, ?, ?)'
  ).run(id, name, description || '', projectPath, ignore_patterns || 'node_modules,.git,dist,build,.next');

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

  const { name, description, path: projectPath, ignore_patterns } = req.body;

  db.prepare(
    'UPDATE projects SET name = ?, description = ?, path = ?, ignore_patterns = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(
    name || project.name,
    description !== undefined ? description : project.description,
    projectPath || project.path,
    ignore_patterns !== undefined ? ignore_patterns : project.ignore_patterns,
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
