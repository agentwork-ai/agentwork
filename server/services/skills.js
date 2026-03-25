const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { DATA_DIR } = require('../db');
const { createCompletion } = require('./ai');

const AGENTWORK_HOME = path.resolve(DATA_DIR);
const SHARED_SKILLS_DIR = path.join(AGENTWORK_HOME, 'skills');
const SKILL_META_FILE = '.agentwork-skill.json';
const MAX_SKILL_CONTEXT_CHARS = 16000;
const MAX_SINGLE_SKILL_CHARS = 6000;

function ensureSkillsDir() {
  fs.mkdirSync(SHARED_SKILLS_DIR, { recursive: true });
  return SHARED_SKILLS_DIR;
}

function parseJsonSafe(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function sanitizeSkillSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeSkillSlugs(input) {
  let values;
  if (Array.isArray(input)) {
    values = input;
  } else {
    const raw = String(input || '').trim();
    if (!raw) {
      values = [];
    } else if (raw.startsWith('[')) {
      const parsed = parseJsonSafe(raw, []);
      values = Array.isArray(parsed) ? parsed : [];
    } else {
      values = raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }

  return Array.from(new Set(values.map(sanitizeSkillSlug).filter(Boolean)));
}

function parseFrontmatter(markdown) {
  const text = String(markdown || '');
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) {
    return { attributes: {}, body: text.trim() };
  }

  const lines = text.split(/\r?\n/);
  if (lines[0].trim() !== '---') {
    return { attributes: {}, body: text.trim() };
  }

  const attrs = {};
  let idx = 1;
  while (idx < lines.length) {
    const line = lines[idx];
    if (line.trim() === '---') {
      idx += 1;
      break;
    }

    const match = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (match) {
      let value = match[2].trim();
      value = value.replace(/^['"]|['"]$/g, '').trim();
      attrs[match[1]] = value;
    }
    idx += 1;
  }

  return {
    attributes: attrs,
    body: lines.slice(idx).join('\n').trim(),
  };
}

function stripCodeFences(content) {
  const text = String(content || '').trim();
  const match = text.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/);
  return match ? match[1].trim() : text;
}

function readSkillMeta(skillDir) {
  const metaPath = path.join(skillDir, SKILL_META_FILE);
  if (!fs.existsSync(metaPath)) return {};
  return parseJsonSafe(fs.readFileSync(metaPath, 'utf8'), {}) || {};
}

function writeSkillMeta(skillDir, meta) {
  const nextMeta = {
    ...meta,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(skillDir, SKILL_META_FILE), JSON.stringify(nextMeta, null, 2));
}

function getSkillDir(slug) {
  return path.join(ensureSkillsDir(), sanitizeSkillSlug(slug));
}

function summarizeResources(skillDir) {
  const result = {
    hasScripts: false,
    hasReferences: false,
    hasAssets: false,
    files: [],
  };

  if (!fs.existsSync(skillDir)) return result;

  const entries = fs.readdirSync(skillDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'SKILL.md' || entry.name === SKILL_META_FILE || entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      if (entry.name === 'scripts') result.hasScripts = true;
      if (entry.name === 'references') result.hasReferences = true;
      if (entry.name === 'assets') result.hasAssets = true;
      continue;
    }
    result.files.push(entry.name);
  }

  result.files = result.files.slice(0, 12);
  return result;
}

function listSkillDirectories() {
  ensureSkillsDir();
  return fs.readdirSync(SHARED_SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .filter((slug) => fs.existsSync(path.join(SHARED_SKILLS_DIR, slug, 'SKILL.md')))
    .sort((a, b) => a.localeCompare(b));
}

function getSkillSummary(slug) {
  const normalizedSlug = sanitizeSkillSlug(slug);
  if (!normalizedSlug) return null;

  const skillDir = getSkillDir(normalizedSlug);
  const skillPath = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillPath)) return null;

  const raw = fs.readFileSync(skillPath, 'utf8');
  const { attributes, body } = parseFrontmatter(raw);
  const meta = readSkillMeta(skillDir);
  const resourceSummary = summarizeResources(skillDir);

  return {
    slug: normalizedSlug,
    name: attributes.name || normalizedSlug,
    description: attributes.description || body.split(/\r?\n/).find(Boolean) || '',
    path: skillDir,
    skill_path: skillPath,
    source: meta.source || 'local',
    creator_agent_id: meta.creator_agent_id || '',
    creator_agent_name: meta.creator_agent_name || '',
    source_path: meta.source_path || '',
    marketplace_slug: meta.marketplace_slug || '',
    created_at: meta.created_at || '',
    updated_at: meta.updated_at || fs.statSync(skillPath).mtime.toISOString(),
    has_scripts: resourceSummary.hasScripts,
    has_references: resourceSummary.hasReferences,
    has_assets: resourceSummary.hasAssets,
    extra_files: resourceSummary.files,
  };
}

function listSkills() {
  return listSkillDirectories()
    .map(getSkillSummary)
    .filter(Boolean);
}

function readSkillContent(slug) {
  const summary = getSkillSummary(slug);
  if (!summary) return null;

  return {
    ...summary,
    content: fs.readFileSync(summary.skill_path, 'utf8'),
  };
}

function getInstalledSkillSlugs() {
  return new Set(listSkillDirectories());
}

function filterInstalledSkillSlugs(input) {
  const installed = getInstalledSkillSlugs();
  return normalizeSkillSlugs(input).filter((slug) => installed.has(slug));
}

function truncateSkillContent(content, budget) {
  const text = String(content || '').trim();
  if (!text) return '';
  if (text.length <= budget) return text;

  const head = Math.max(256, Math.floor(budget * 0.75));
  const tail = Math.max(64, budget - head - 16);
  return `${text.slice(0, head).trim()}\n\n...[truncated]...\n\n${text.slice(-tail).trim()}`;
}

function getAssignedSkillContextEntries(agent) {
  const assigned = filterInstalledSkillSlugs(agent?.skills || agent?.skills_json);
  if (assigned.length === 0) return [];

  let remaining = MAX_SKILL_CONTEXT_CHARS;
  const entries = [];

  for (const slug of assigned) {
    if (remaining < 256) break;
    const summary = getSkillSummary(slug);
    if (!summary) continue;

    const raw = fs.readFileSync(summary.skill_path, 'utf8');
    const budget = Math.min(MAX_SINGLE_SKILL_CHARS, remaining);
    const content = truncateSkillContent(raw, budget);
    if (!content) continue;

    entries.push({
      ...summary,
      content,
    });
    remaining -= content.length;
  }

  return entries;
}

function buildSkillTemplate({ creatorAgent, slug, name, description, useWhen, workflow, notes }) {
  const skillDescription = description || useWhen || `Use when work matches ${name}.`;
  const lines = [
    '---',
    `name: ${slug}`,
    `description: ${skillDescription}`,
    '---',
    '',
    `# ${name}`,
    '',
    `Created with ${creatorAgent?.name || 'AgentWork'}.`,
    '',
    '## Use When',
    useWhen || description || `Use when the task clearly matches ${name}.`,
    '',
    '## Workflow',
    workflow || `1. Clarify the task and gather the required context.\n2. Inspect the relevant files, tools, and inputs.\n3. Execute the work with concrete outputs.\n4. Verify the result and summarize the outcome.`,
  ];

  if (notes) {
    lines.push('', '## Notes', notes.trim());
  }

  if (creatorAgent?.role || creatorAgent?.personality) {
    lines.push(
      '',
      '## Author Hints',
      `- Role: ${creatorAgent.role || 'Assistant'}`,
      creatorAgent.personality ? `- Working style: ${creatorAgent.personality}` : '- Working style: pragmatic and concise',
    );
  }

  return `${lines.join('\n').trim()}\n`;
}

async function generateSkillMarkdown({ creatorAgent, slug, name, description, useWhen, workflow, notes }) {
  const canUseModel = Boolean(creatorAgent)
    && creatorAgent.auth_type !== 'cli'
    && !['claude-cli', 'codex-cli', 'openai-codex'].includes(creatorAgent.provider);

  if (!canUseModel) {
    return buildSkillTemplate({ creatorAgent, slug, name, description, useWhen, workflow, notes });
  }

  const role = creatorAgent.role || 'Assistant';
  const personality = creatorAgent.personality ? `\nPersonality hints: ${creatorAgent.personality}` : '';
  const prompt = [
    'Write a concise AgentSkills-compatible SKILL.md file.',
    'Return only the markdown file content. Do not wrap it in code fences.',
    'The file must include YAML frontmatter with `name` and `description`.',
    'Keep it practical and short. Assume the agent is already smart.',
    'Include sections only if they add real value.',
    '',
    `Skill slug: ${slug}`,
    `Skill name: ${name}`,
    `Short description: ${description || useWhen || name}`,
    `Use when: ${useWhen || description || name}`,
    `Preferred workflow: ${workflow || 'Clarify, inspect context, execute, verify, summarize.'}`,
    notes ? `Additional notes: ${notes}` : '',
    `Authoring agent role: ${role}${personality}`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const response = await createCompletion(creatorAgent.provider, creatorAgent.model || '', [
      {
        role: 'system',
        content: 'You create compact, practical SKILL.md files for coding agents.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ], {
      fallbackModel: creatorAgent.fallback_model,
      maxTokens: 2200,
    });

    const content = stripCodeFences(response.content || '');
    if (!content.trim()) {
      throw new Error('Empty skill generation response.');
    }

    return content.trim().startsWith('---')
      ? `${content.trim()}\n`
      : buildSkillTemplate({ creatorAgent, slug, name, description, useWhen, workflow, notes });
  } catch {
    return buildSkillTemplate({ creatorAgent, slug, name, description, useWhen, workflow, notes });
  }
}

function resolveImportSource(sourcePath) {
  const expanded = String(sourcePath || '').trim().replace(/^~(?=\/|$)/, os.homedir());
  const resolved = path.resolve(expanded);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Import source does not exist: ${resolved}`);
  }

  const stat = fs.statSync(resolved);
  const sourceDir = stat.isDirectory() ? resolved : path.dirname(resolved);
  const skillFile = stat.isDirectory() ? path.join(sourceDir, 'SKILL.md') : resolved;
  if (path.basename(skillFile) !== 'SKILL.md' || !fs.existsSync(skillFile)) {
    throw new Error('Import source must be a skill folder containing SKILL.md or a direct path to SKILL.md.');
  }

  return {
    sourceDir,
    skillFile,
  };
}

function copyDirectoryRecursive(sourceDir, targetDir) {
  fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: (src) => path.basename(src) !== SKILL_META_FILE,
  });
}

async function createSkill({ creatorAgent, name, slug, description, useWhen, workflow, notes }) {
  ensureSkillsDir();
  const normalizedSlug = sanitizeSkillSlug(slug || name);
  if (!normalizedSlug) {
    throw new Error('Skill name or slug is required.');
  }

  const skillDir = getSkillDir(normalizedSlug);
  if (fs.existsSync(skillDir)) {
    throw new Error(`A skill already exists at ${skillDir}`);
  }

  const markdown = await generateSkillMarkdown({
    creatorAgent,
    slug: normalizedSlug,
    name: String(name || normalizedSlug).trim(),
    description: String(description || '').trim(),
    useWhen: String(useWhen || '').trim(),
    workflow: String(workflow || '').trim(),
    notes: String(notes || '').trim(),
  });

  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), markdown);
  writeSkillMeta(skillDir, {
    source: 'created',
    creator_agent_id: creatorAgent?.id || '',
    creator_agent_name: creatorAgent?.name || '',
    created_at: new Date().toISOString(),
  });

  return readSkillContent(normalizedSlug);
}

function importSkillFromPath({ sourcePath, slug }) {
  ensureSkillsDir();
  const { sourceDir, skillFile } = resolveImportSource(sourcePath);
  const frontmatter = parseFrontmatter(fs.readFileSync(skillFile, 'utf8'));
  const baseSlug = slug || frontmatter.attributes.name || path.basename(sourceDir);
  const normalizedSlug = sanitizeSkillSlug(baseSlug);
  if (!normalizedSlug) {
    throw new Error('Could not determine a valid skill slug.');
  }

  const targetDir = getSkillDir(normalizedSlug);
  if (fs.existsSync(targetDir)) {
    throw new Error(`A skill already exists at ${targetDir}`);
  }

  copyDirectoryRecursive(sourceDir, targetDir);
  writeSkillMeta(targetDir, {
    source: 'imported',
    source_path: sourceDir,
    created_at: new Date().toISOString(),
  });

  return readSkillContent(normalizedSlug);
}

function parseClawHubSlug(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    throw new Error('A ClawHub slug or URL is required.');
  }

  if (/^https?:\/\//i.test(raw)) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new Error('Invalid ClawHub URL.');
    }
    const parts = url.pathname.split('/').filter(Boolean);
    const slug = parts[0] === 'skills' ? parts[1] : parts[parts.length - 1];
    if (!slug) {
      throw new Error('Could not determine a skill slug from the ClawHub URL.');
    }
    return sanitizeSkillSlug(slug.replace(/@.+$/, ''));
  }

  return sanitizeSkillSlug(raw.replace(/@.+$/, ''));
}

function installSkillFromClawHub(slugOrUrl) {
  ensureSkillsDir();
  const marketplaceSlug = parseClawHubSlug(slugOrUrl);
  if (!marketplaceSlug) {
    throw new Error('Invalid ClawHub slug.');
  }

  const before = new Set(listSkillDirectories());
  try {
    execFileSync('npx', ['--yes', 'clawhub@latest', 'install', marketplaceSlug], {
      cwd: AGENTWORK_HOME,
      env: {
        ...process.env,
        CLAWHUB_WORKDIR: AGENTWORK_HOME,
      },
      encoding: 'utf8',
      timeout: 300000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const stderr = String(err.stderr || err.stdout || err.message || '').trim();
    throw new Error(stderr || `Failed to install ${marketplaceSlug} from ClawHub.`);
  }

  const after = listSkillDirectories();
  const installedSlug = after.find((slug) => !before.has(slug))
    || after.find((slug) => slug === marketplaceSlug)
    || after.find((slug) => slug.includes(marketplaceSlug));

  if (!installedSlug) {
    throw new Error(`ClawHub install completed but no new skill folder was found for ${marketplaceSlug}.`);
  }

  const skillDir = getSkillDir(installedSlug);
  writeSkillMeta(skillDir, {
    source: 'clawhub',
    marketplace_slug: marketplaceSlug,
    created_at: new Date().toISOString(),
  });

  return readSkillContent(installedSlug);
}

function deleteSkill(slug) {
  const normalizedSlug = sanitizeSkillSlug(slug);
  const skillDir = getSkillDir(normalizedSlug);
  if (!fs.existsSync(skillDir)) {
    throw new Error('Skill not found.');
  }

  fs.rmSync(skillDir, { recursive: true, force: true });
  return normalizedSlug;
}

module.exports = {
  AGENTWORK_HOME,
  SHARED_SKILLS_DIR,
  createSkill,
  deleteSkill,
  ensureSkillsDir,
  filterInstalledSkillSlugs,
  getAssignedSkillContextEntries,
  getSkillSummary,
  importSkillFromPath,
  installSkillFromClawHub,
  listSkills,
  normalizeSkillSlugs,
  parseFrontmatter,
  readSkillContent,
  sanitizeSkillSlug,
};
