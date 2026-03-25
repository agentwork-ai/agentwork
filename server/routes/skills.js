const express = require('express');
const router = express.Router();
const { db, logAudit } = require('../db');
const {
  AGENTWORK_HOME,
  SHARED_SKILLS_DIR,
  createSkill,
  deleteSkill,
  importSkillFromPath,
  installSkillFromClawHub,
  listSkills,
  normalizeSkillSlugs,
  readSkillContent,
  sanitizeSkillSlug,
} = require('../services/skills');

function parseSkillsJson(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildAssignmentMap() {
  const assignments = new Map();
  const agents = db.prepare('SELECT id, name, avatar, skills_json FROM agents ORDER BY name COLLATE NOCASE').all();

  for (const agent of agents) {
    for (const slug of normalizeSkillSlugs(parseSkillsJson(agent.skills_json))) {
      const current = assignments.get(slug) || [];
      current.push({ id: agent.id, name: agent.name, avatar: agent.avatar || '🤖' });
      assignments.set(slug, current);
    }
  }

  return assignments;
}

function enrichSkill(skill, assignments) {
  const assignedAgents = assignments.get(skill.slug) || [];
  return {
    ...skill,
    shared_skills_dir: SHARED_SKILLS_DIR,
    agentwork_home: AGENTWORK_HOME,
    assigned_agents: assignedAgents,
    assigned_count: assignedAgents.length,
  };
}

router.get('/', (req, res) => {
  const assignments = buildAssignmentMap();
  const skills = listSkills().map((skill) => enrichSkill(skill, assignments));
  res.json({
    agentwork_home: AGENTWORK_HOME,
    shared_skills_dir: SHARED_SKILLS_DIR,
    marketplace_url: 'https://clawhub.ai/',
    skills,
  });
});

router.get('/:slug', (req, res) => {
  const skill = readSkillContent(req.params.slug);
  if (!skill) return res.status(404).json({ error: 'Skill not found' });

  const assignments = buildAssignmentMap();
  res.json(enrichSkill(skill, assignments));
});

router.post('/create', async (req, res) => {
  const { creator_agent_id, name, slug, description, use_when, workflow, notes } = req.body || {};
  if (!creator_agent_id) return res.status(400).json({ error: 'creator_agent_id is required' });
  if (!name) return res.status(400).json({ error: 'name is required' });

  const creatorAgent = db.prepare('SELECT * FROM agents WHERE id = ?').get(creator_agent_id);
  if (!creatorAgent) return res.status(404).json({ error: 'Creator agent not found' });

  try {
    const skill = await createSkill({
      creatorAgent,
      name,
      slug,
      description,
      useWhen: use_when,
      workflow,
      notes,
    });
    const assignments = buildAssignmentMap();
    logAudit('create', 'skill', skill.slug, {
      source: 'created',
      creator_agent_id,
      name: skill.name,
    });
    res.status(201).json(enrichSkill(skill, assignments));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/import', (req, res) => {
  const { source_path, slug } = req.body || {};
  if (!source_path) return res.status(400).json({ error: 'source_path is required' });

  try {
    const skill = importSkillFromPath({ sourcePath: source_path, slug });
    const assignments = buildAssignmentMap();
    logAudit('import', 'skill', skill.slug, {
      source: 'local',
      source_path,
    });
    res.status(201).json(enrichSkill(skill, assignments));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/install', (req, res) => {
  const { slug_or_url } = req.body || {};
  if (!slug_or_url) return res.status(400).json({ error: 'slug_or_url is required' });

  try {
    const skill = installSkillFromClawHub(slug_or_url);
    const assignments = buildAssignmentMap();
    logAudit('install', 'skill', skill.slug, {
      source: 'clawhub',
      slug_or_url,
    });
    res.status(201).json(enrichSkill(skill, assignments));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:slug', (req, res) => {
  const normalizedSlug = sanitizeSkillSlug(req.params.slug);
  if (!normalizedSlug) return res.status(400).json({ error: 'Invalid skill slug' });

  try {
    deleteSkill(normalizedSlug);

    const agents = db.prepare('SELECT id, skills_json FROM agents').all();
    for (const agent of agents) {
      const nextSkills = normalizeSkillSlugs(parseSkillsJson(agent.skills_json)).filter((slug) => slug !== normalizedSlug);
      db.prepare('UPDATE agents SET skills_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(JSON.stringify(nextSkills), agent.id);
    }

    logAudit('delete', 'skill', normalizedSlug, { slug: normalizedSlug });
    res.json({ success: true, slug: normalizedSlug });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
