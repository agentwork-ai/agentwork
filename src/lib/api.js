const BASE = '';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || 'Request failed');
  }

  return res.json();
}

export const api = {
  // Projects
  getProjects: () => request('/api/projects'),
  getProject: (id) => request(`/api/projects/${id}`),
  createProject: (data) => request('/api/projects', { method: 'POST', body: JSON.stringify(data) }),
  updateProject: (id, data) => request(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProject: (id) => request(`/api/projects/${id}`, { method: 'DELETE' }),
  getProjectFiles: (id, depth) => request(`/api/projects/${id}/files?depth=${depth || 3}`),
  regenerateProjectDoc: (id) => request(`/api/projects/${id}/regenerate-doc`, { method: 'POST' }),

  // Tasks
  getTasks: (params) => {
    const qs = new URLSearchParams(params || {}).toString();
    return request(`/api/tasks${qs ? '?' + qs : ''}`);
  },
  getTask: (id) => request(`/api/tasks/${id}`),
  createTask: (data) => request('/api/tasks', { method: 'POST', body: JSON.stringify(data) }),
  updateTask: (id, data) => request(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTask: (id) => request(`/api/tasks/${id}`, { method: 'DELETE' }),

  // Agents
  getAgents: () => request('/api/agents'),
  getAgent: (id) => request(`/api/agents/${id}`),
  createAgent: (data) => request('/api/agents', { method: 'POST', body: JSON.stringify(data) }),
  updateAgent: (id, data) => request(`/api/agents/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAgent: (id) => request(`/api/agents/${id}`, { method: 'DELETE' }),
  updateAgentMemory: (id, filename, content) =>
    request(`/api/agents/${id}/memory/${filename}`, { method: 'PUT', body: JSON.stringify({ content }) }),
  clearAgentMemory: (id) => request(`/api/agents/${id}/clear-memory`, { method: 'POST' }),
  cloneAgent: (id, name) => request(`/api/agents/${id}/clone`, { method: 'POST', body: JSON.stringify({ name }) }),

  // Chat
  getMessages: (agentId, limit) => request(`/api/chat/${agentId}?limit=${limit || 100}`),
  searchMessages: (agentId, query) => request(`/api/chat/${agentId}/search?q=${encodeURIComponent(query)}`),

  // Settings
  getSettings: () => request('/api/settings'),
  updateSettings: (data) => request('/api/settings', { method: 'PUT', body: JSON.stringify(data) }),
  getBudget: () => request('/api/settings/budget'),
  getBudgetHistory: (days) => request(`/api/settings/budget/history?days=${days || 30}`),
  getBudgetByAgent: (days) => request(`/api/settings/budget/by-agent?days=${days || 30}`),
  getBudgetByModel: (days) => request(`/api/settings/budget/by-model?days=${days || 30}`),

  // Files
  readFile: (path) => request(`/api/files/read?path=${encodeURIComponent(path)}`),
  browseFolder: () => request('/api/files/browse-folder'),

  // Status
  getStatus: () => request('/api/status'),
};
