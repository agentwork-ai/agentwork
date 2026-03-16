/**
 * Linear / Jira Integration Service
 * Syncs tasks bidirectionally with external project management tools.
 * Uses REST API (no npm dependencies needed).
 *
 * Settings: linear_api_key, linear_team_id for Linear
 *           jira_url, jira_email, jira_api_token, jira_project_key for Jira
 */
const { db } = require('../db');
const { decrypt, isSensitiveKey } = require('../crypto');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return '';
  return isSensitiveKey(key) ? decrypt(row.value) : row.value;
}

// ─── Linear Integration ───

async function syncToLinear(task) {
  const apiKey = getSetting('linear_api_key');
  const teamId = getSetting('linear_team_id');
  if (!apiKey || !teamId) return null;

  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `mutation { issueCreate(input: { teamId: "${teamId}", title: "${task.title.replace(/"/g, '\\"')}", description: "${(task.description || '').replace(/"/g, '\\"').replace(/\n/g, '\\n')}" }) { issue { id identifier url } } }`,
    }),
  });

  return res.json();
}

// ─── Jira Integration ───

async function syncToJira(task) {
  const url = getSetting('jira_url');
  const email = getSetting('jira_email');
  const token = getSetting('jira_api_token');
  const projectKey = getSetting('jira_project_key');
  if (!url || !email || !token || !projectKey) return null;

  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const res = await fetch(`${url}/rest/api/3/issue`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        project: { key: projectKey },
        summary: task.title,
        description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: task.description || '' }] }] },
        issuetype: { name: 'Task' },
      },
    }),
  });

  return res.json();
}

module.exports = { syncToLinear, syncToJira };
