/**
 * Agent Context Builder — OpenClaw-inspired intelligence system
 *
 * Builds token-efficient system prompts from agent memory files:
 *   SOUL.md   — Personality, tone, identity (always loaded first)
 *   AGENTS.md — Operational rules, conventions, project knowledge
 *   USER.md   — Human profile, preferences, coding style
 *   MEMORY.md — Persistent long-term memory (task/chat history)
 *
 * Key principles:
 *   1. Structured sections with clear headers
 *   2. Per-file and total character budgets with smart truncation
 *   3. Session-aware filtering (skip MEMORY.md for subagent/flow steps)
 *   4. SOUL.md gets priority — always loaded first, never truncated first
 */

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../db');

// ─── Budgets ───
const PER_FILE_MAX_CHARS = 6000;    // ~1500 tokens per file
const TOTAL_CONTEXT_MAX_CHARS = 20000; // ~5000 tokens total for all memory files
const TRUNCATION_HEAD_RATIO = 0.75;    // Keep 75% from start
const TRUNCATION_TAIL_RATIO = 0.20;    // Keep 20% from end

// ─── Default Templates ───

const DEFAULT_SOUL = (name, role, personality) => `# ${name}

You are **${name}**, a ${role}.

## Personality
${personality || 'Professional, concise, and action-oriented.'}

## Principles
- Act autonomously — make decisions, don't ask for confirmation
- Be concise — say what matters, skip filler
- Show your work through actions, not explanations
- When uncertain, make your best judgment and proceed
- Admit mistakes quickly and fix them
`;

const DEFAULT_AGENTS = (name) => `# Operational Rules for ${name}

## Session Protocol
1. Read your memory files at session start for context
2. After completing tasks, your memory will be updated automatically
3. Focus on the task at hand — avoid unnecessary side work

## Code Quality
- Read existing code before making changes
- Follow the project's existing conventions
- Test your changes when possible
- Keep changes minimal and focused

## Communication
- Be direct and specific in task_complete summaries
- Report blockers immediately via request_help
- Include file paths and line numbers when referencing code
`;

const DEFAULT_USER = `# User Profile

No user preferences recorded yet. Preferences will be learned over time from interactions.
`;

// ─── Core Functions ───

/**
 * Truncate content smartly: keep head + tail with a marker in between.
 * This preserves the most recent entries (tail) and core identity (head).
 */
function truncateContent(content, maxChars) {
  if (!content || content.length <= maxChars) return content;

  const headBudget = Math.floor(maxChars * TRUNCATION_HEAD_RATIO);
  const tailBudget = Math.floor(maxChars * TRUNCATION_TAIL_RATIO);

  const head = content.slice(0, headBudget);
  const tail = content.slice(-tailBudget);
  const omitted = content.length - headBudget - tailBudget;

  return `${head}\n\n[... ${omitted} chars omitted for brevity ...]\n\n${tail}`;
}

/**
 * Read an agent memory file with optional truncation.
 */
function readMemoryFile(agentDir, filename, budget) {
  const filePath = path.join(agentDir, filename);
  try {
    if (!fs.existsSync(filePath)) return '';
    const content = fs.readFileSync(filePath, 'utf8').trim();
    return budget ? truncateContent(content, budget) : content;
  } catch {
    return '';
  }
}

/**
 * Ensure default memory files exist for an agent.
 * Called when an agent is created or on first use.
 */
function ensureMemoryFiles(agentId, agent) {
  const agentDir = path.join(DATA_DIR, 'agents', agentId);
  if (!fs.existsSync(agentDir)) fs.mkdirSync(agentDir, { recursive: true });

  const files = {
    'SOUL.md': DEFAULT_SOUL(agent.name, agent.role, agent.personality),
    'AGENTS.md': DEFAULT_AGENTS(agent.name),
    'USER.md': DEFAULT_USER,
    'MEMORY.md': '',
  };

  for (const [filename, defaultContent] of Object.entries(files)) {
    const filePath = path.join(agentDir, filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, defaultContent);
    }
  }
}

/**
 * Build the agent identity + context section for a system prompt.
 *
 * @param {string} agentId
 * @param {object} agent - { name, role, personality }
 * @param {object} options
 * @param {boolean} options.includeMemory - Load MEMORY.md (false for subagent/flow steps)
 * @param {number}  options.perFileBudget - Max chars per file
 * @param {number}  options.totalBudget   - Max total chars for all context
 * @returns {string} Formatted context string for injection into system prompt
 */
function buildAgentContext(agentId, agent, options = {}) {
  const {
    includeMemory = true,
    perFileBudget = PER_FILE_MAX_CHARS,
    totalBudget = TOTAL_CONTEXT_MAX_CHARS,
  } = options;

  const agentDir = path.join(DATA_DIR, 'agents', agentId);
  ensureMemoryFiles(agentId, agent);

  // Load files in priority order — SOUL first (identity), then rules, user, memory
  let remaining = totalBudget;
  const sections = [];

  // 1. SOUL.md — Identity & personality (highest priority)
  const soul = readMemoryFile(agentDir, 'SOUL.md', Math.min(perFileBudget, remaining));
  if (soul) {
    sections.push(soul);
    remaining -= soul.length;
  }

  // 2. AGENTS.md — Operational rules & project conventions
  if (remaining > 200) {
    const rules = readMemoryFile(agentDir, 'AGENTS.md', Math.min(perFileBudget, remaining));
    if (rules) {
      sections.push(`## Operational Rules\n${rules}`);
      remaining -= rules.length;
    }
  }

  // 3. USER.md — Human preferences
  if (remaining > 200) {
    const user = readMemoryFile(agentDir, 'USER.md', Math.min(perFileBudget, remaining));
    if (user) {
      sections.push(`## User Preferences\n${user}`);
      remaining -= user.length;
    }
  }

  // 4. MEMORY.md — Long-term memory (skip for subagent/flow contexts)
  if (includeMemory && remaining > 200) {
    const memory = readMemoryFile(agentDir, 'MEMORY.md', Math.min(perFileBudget, remaining));
    if (memory) {
      sections.push(`## Your Memory\n${memory}`);
    }
  }

  return sections.join('\n\n');
}

/**
 * Build a complete system prompt for task execution.
 */
function buildTaskSystemPrompt(agent, agentContext, { projectDoc, projectActivity, customToolsPrompt, workDir }) {
  return `You are ${agent.name}, an autonomous AI agent working as a ${agent.role}.

${agentContext}

${projectDoc ? `## Project Documentation\n${projectDoc}\n` : ''}## Available Tools
Use tools to complete your task — do NOT write explanations without acting:
- **read_file**: Read file contents
- **write_file**: Create or overwrite a file
- **delete_path**: Remove files or directories
- **run_bash**: Execute shell commands (npm, git, mkdir, etc.)
- **list_directory**: Browse the file structure
- **task_complete**: Call when ALL work is done (required to finish the task)
- **request_help**: Only if truly blocked (missing credentials, broken env)${customToolsPrompt || ''}

## Rules
1. ALWAYS proceed autonomously. Never ask for confirmation or clarification.
2. Make your best judgment on ambiguous requirements.
3. Use tools to read code, make changes, and verify your work.
4. When finished, call task_complete with a summary.
5. ${workDir ? `Working directory: ${workDir}` : 'Use the provided working directory.'}
${projectActivity || ''}`.trim();
}

/**
 * Build a system prompt for direct chat (lighter than task execution).
 */
function buildChatSystemPrompt(agent, agentContext) {
  return `You are ${agent.name}, a ${agent.role}. Be concise and friendly.

${agentContext}`.trim();
}

/**
 * Build a system prompt for flow steps (subagent context — no MEMORY.md).
 */
function buildFlowStepSystemPrompt(agent, agentContext, { projectDoc, customToolsPrompt, workDir, stepIdx, totalSteps }) {
  return `You are ${agent.name}, an autonomous AI agent working as a ${agent.role}.

${agentContext}

${projectDoc ? `## Project Documentation\n${projectDoc}\n` : ''}## Available Tools
- **read_file**: Read file contents
- **write_file**: Create or overwrite a file
- **delete_path**: Remove files or directories
- **run_bash**: Execute shell commands
- **list_directory**: Browse the file structure
- **task_complete**: Call when your step is done${customToolsPrompt || ''}

## Rules
1. Proceed autonomously — no confirmation needed.
2. Focus only on your assigned step (${stepIdx + 1}/${totalSteps}).
3. When done, call task_complete with a summary.
4. Working directory: ${workDir}`.trim();
}

module.exports = {
  buildAgentContext,
  buildTaskSystemPrompt,
  buildChatSystemPrompt,
  buildFlowStepSystemPrompt,
  ensureMemoryFiles,
  truncateContent,
  readMemoryFile,
  PER_FILE_MAX_CHARS,
  TOTAL_CONTEXT_MAX_CHARS,
};
