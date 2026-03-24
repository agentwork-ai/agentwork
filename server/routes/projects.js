const express = require('express');
const router = express.Router();
const { db, uuidv4 } = require('../db');
const { generateProjectDoc } = require('../services/project-doc');
const fs = require('fs');
const path = require('path');

function resolveAgentId(value) {
  const agentId = String(value || '').trim();
  if (!agentId) return null;
  const exists = db.prepare('SELECT 1 FROM agents WHERE id = ?').get(agentId);
  return exists ? agentId : null;
}

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
  const {
    name,
    description,
    path: projectPath,
    ignore_patterns,
    default_agent_id,
    project_manager_agent_id,
    main_developer_agent_id,
  } = req.body;

  if (!name || !projectPath) {
    return res.status(400).json({ error: 'Name and path are required' });
  }

  if (!fs.existsSync(projectPath)) {
    return res.status(400).json({ error: 'Path does not exist' });
  }

  const projectManagerAgentId = resolveAgentId(
    project_manager_agent_id !== undefined ? project_manager_agent_id : default_agent_id
  );
  const mainDeveloperAgentId = resolveAgentId(main_developer_agent_id);

  const id = uuidv4();
  db.prepare(
    `INSERT INTO projects
      (id, name, description, path, ignore_patterns, default_agent_id, project_manager_agent_id, main_developer_agent_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    name,
    description || '',
    projectPath,
    ignore_patterns || 'node_modules,.git,dist,build,.next',
    projectManagerAgentId,
    projectManagerAgentId,
    mainDeveloperAgentId,
  );

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

  const {
    name,
    description,
    path: projectPath,
    ignore_patterns,
    default_agent_id,
    project_manager_agent_id,
    main_developer_agent_id,
  } = req.body;

  const projectManagerAgentId = project_manager_agent_id !== undefined
    ? resolveAgentId(project_manager_agent_id)
    : default_agent_id !== undefined
      ? resolveAgentId(default_agent_id)
      : project.project_manager_agent_id || project.default_agent_id || null;

  const mainDeveloperAgentId = main_developer_agent_id !== undefined
    ? resolveAgentId(main_developer_agent_id)
    : project.main_developer_agent_id || null;

  db.prepare(
    `UPDATE projects
     SET name = ?, description = ?, path = ?, ignore_patterns = ?, default_agent_id = ?,
         project_manager_agent_id = ?, main_developer_agent_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(
    name || project.name,
    description !== undefined ? description : project.description,
    projectPath || project.path,
    ignore_patterns !== undefined ? ignore_patterns : project.ignore_patterns,
    projectManagerAgentId,
    projectManagerAgentId,
    mainDeveloperAgentId,
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

// Get git status for a project
router.get('/:id/git-status', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  try {
    const { execSync } = require('child_process');
    execSync('git rev-parse --is-inside-work-tree', { cwd: project.path, stdio: 'pipe' });

    const status = execSync('git status --porcelain', { cwd: project.path, encoding: 'utf8', timeout: 5000 });
    const branch = execSync('git branch --show-current', { cwd: project.path, encoding: 'utf8', timeout: 5000 }).trim();
    const files = {};
    for (const line of status.split('\n').filter(Boolean)) {
      const code = line.slice(0, 2).trim();
      const filePath = line.slice(3);
      files[filePath] = code === 'M' ? 'modified' : code === 'A' ? 'added' : code === 'D' ? 'deleted' : code === '??' ? 'untracked' : code;
    }
    res.json({ isGitRepo: true, branch, files, changedCount: Object.keys(files).length });
  } catch {
    res.json({ isGitRepo: false, branch: null, files: {}, changedCount: 0 });
  }
});

// Get git diff for a project
router.get('/:id/diff', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  try {
    const { execSync } = require('child_process');
    execSync('git rev-parse --is-inside-work-tree', { cwd: project.path, stdio: 'pipe' });

    const ref = req.query.ref || null;
    // Sanitize ref to prevent command injection — only allow safe git ref characters
    if (ref && !/^[a-zA-Z0-9_.\/~^@{}\-]+$/.test(ref)) {
      return res.status(400).json({ error: 'Invalid ref parameter' });
    }
    let diff;
    if (ref) {
      // Diff against a specific ref (e.g. HEAD~1, a commit SHA, a branch)
      diff = execSync(`git diff ${ref}`, {
        cwd: project.path,
        encoding: 'utf8',
        timeout: 15000,
        maxBuffer: 10 * 1024 * 1024,
      });
    } else {
      // Default: show working tree changes (staged + unstaged)
      diff = execSync('git diff HEAD', {
        cwd: project.path,
        encoding: 'utf8',
        timeout: 15000,
        maxBuffer: 10 * 1024 * 1024,
      });
      // If no diff against HEAD (e.g. no commits yet or everything committed),
      // fall back to just unstaged changes
      if (!diff.trim()) {
        diff = execSync('git diff', {
          cwd: project.path,
          encoding: 'utf8',
          timeout: 15000,
          maxBuffer: 10 * 1024 * 1024,
        });
      }
    }

    res.json({ diff, ref: ref || 'HEAD' });
  } catch (err) {
    // If git diff HEAD fails (e.g. no commits), try just git diff
    if (err.stderr && err.stderr.includes('unknown revision')) {
      try {
        const { execSync } = require('child_process');
        const diff = execSync('git diff', {
          cwd: project.path,
          encoding: 'utf8',
          timeout: 15000,
          maxBuffer: 10 * 1024 * 1024,
        });
        return res.json({ diff, ref: 'working-tree' });
      } catch {
        // fall through
      }
    }
    res.json({ diff: '', ref: req.query.ref || 'HEAD', error: 'Not a git repository or git diff failed' });
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
