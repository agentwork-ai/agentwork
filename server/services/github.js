/**
 * GitHub Integration Service
 * Creates issues from blocked tasks, PRs from completed tasks.
 * Requires: github_token setting and github_repo setting (e.g., "owner/repo").
 * Uses GitHub REST API directly (no npm dependencies needed).
 */
const { db } = require('../db');
const { decrypt, isSensitiveKey } = require('../crypto');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return '';
  return isSensitiveKey(key) ? decrypt(row.value) : row.value;
}

async function githubRequest(method, path, body) {
  const token = getSetting('github_token');
  const repo = getSetting('github_repo');
  if (!token || !repo) throw new Error('GitHub not configured. Set github_token and github_repo in settings.');

  const url = `https://api.github.com/repos/${repo}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub API error ${res.status}: ${err.message || res.statusText}`);
  }
  return res.json();
}

async function createIssueFromTask(task) {
  return githubRequest('POST', '/issues', {
    title: `[AgentWork] ${task.title}`,
    body: `**Task blocked in AgentWork**\n\n${task.description || ''}\n\n---\nCreated automatically from AgentWork task \`${task.id}\``,
    labels: ['agentwork', 'blocked'],
  });
}

async function createPRFromTask(task, branch, baseBranch) {
  return githubRequest('POST', '/pulls', {
    title: task.title,
    body: `## Changes by AgentWork\n\n${task.completion_output || task.description || ''}\n\n---\nTask: \`${task.id}\``,
    head: branch,
    base: baseBranch || 'main',
  });
}

async function listIssues(state) {
  return githubRequest('GET', `/issues?state=${state || 'open'}&labels=agentwork`);
}

module.exports = { createIssueFromTask, createPRFromTask, listIssues, githubRequest };
