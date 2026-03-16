const vscode = require('vscode');

function getServerUrl() {
  return vscode.workspace.getConfiguration('agentwork').get('serverUrl', 'http://localhost:1248');
}

async function apiRequest(path) {
  const url = `${getServerUrl()}${path}`;
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('agentwork.showStatus', async () => {
      try {
        const status = await apiRequest('/api/status');
        vscode.window.showInformationMessage(
          `AgentWork: ${status.activeAgents} agents, ${status.activeTasks} tasks running, $${status.dailySpend?.toFixed(4) || '0'} today`
        );
      } catch (err) {
        vscode.window.showErrorMessage(`AgentWork: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('agentwork.createTask', async () => {
      const title = await vscode.window.showInputBox({ prompt: 'Task title' });
      if (!title) return;
      try {
        const res = await fetch(`${getServerUrl()}/api/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, status: 'todo' }),
        });
        if (res.ok) vscode.window.showInformationMessage(`Task created: ${title}`);
        else vscode.window.showErrorMessage('Failed to create task');
      } catch (err) {
        vscode.window.showErrorMessage(`AgentWork: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('agentwork.listAgents', async () => {
      try {
        const agents = await apiRequest('/api/agents');
        const items = agents.map((a) => `${a.avatar} ${a.name} (${a.status}) — ${a.role}`);
        vscode.window.showQuickPick(items, { placeHolder: 'Agents' });
      } catch (err) {
        vscode.window.showErrorMessage(`AgentWork: ${err.message}`);
      }
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
