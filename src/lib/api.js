const BASE = '';

function getAuthHeaders() {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('agentwork-auth-token');
    if (token) return { 'x-auth-token': token };
  }
  return {};
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), ...options.headers },
    ...options,
  });

  // If unauthorized, redirect to trigger login screen
  if (res.status === 401 && typeof window !== 'undefined') {
    // Emit a custom event so the auth provider can show the login screen
    window.dispatchEvent(new CustomEvent('agentwork:auth-required'));
    throw new Error('Authentication required');
  }

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
  getProjectHealth: (id) => request(`/api/projects/${id}/health`),
  getProjectGitStatus: (id) => request(`/api/projects/${id}/git-status`),
  getProjectDiff: (id, ref) =>
    request(`/api/projects/${id}/diff${ref ? '?ref=' + encodeURIComponent(ref) : ''}`),
  searchProjectFiles: (id, query, searchContent) =>
    request(`/api/projects/${id}/search?q=${encodeURIComponent(query)}${searchContent ? '&content=true' : ''}`),

  // Tasks
  getTasks: (params) => {
    const qs = new URLSearchParams(params || {}).toString();
    return request(`/api/tasks${qs ? '?' + qs : ''}`);
  },
  getTask: (id) => request(`/api/tasks/${id}`),
  createTask: (data) => request('/api/tasks', { method: 'POST', body: JSON.stringify(data) }),
  updateTask: (id, data) => request(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTask: (id) => request(`/api/tasks/${id}`, { method: 'DELETE' }),
  bulkTaskAction: (action, taskIds, data) =>
    request('/api/tasks/bulk', { method: 'POST', body: JSON.stringify({ action, task_ids: taskIds, data }) }),
  getTaskReplay: (id) => request(`/api/tasks/${id}/replay`),
  getSubtasks: (id) => request(`/api/tasks/${id}/subtasks`),
  createSubtask: (id, data) => request(`/api/tasks/${id}/subtasks`, { method: 'POST', body: JSON.stringify(data) }),
  getTaskComments: (taskId) => request(`/api/tasks/${taskId}/comments`),
  addTaskComment: (taskId, content) =>
    request(`/api/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify({ content }) }),

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
  getAgentMetrics: (id) => request(`/api/agents/${id}/metrics`),
  suggestAgent: (title, description, projectId) =>
    request(`/api/agents/suggest?title=${encodeURIComponent(title || '')}&description=${encodeURIComponent(description || '')}${projectId ? `&project_id=${projectId}` : ''}`),
  sendAgentMessage: (agentId, fromAgentId, content) =>
    request(`/api/agents/${agentId}/message`, { method: 'POST', body: JSON.stringify({ from_agent_id: fromAgentId, content }) }),
  getAgentInbox: (agentId) => request(`/api/agents/${agentId}/inbox`),

  // Chat
  getMessages: (agentId, limit) => request(`/api/chat/${agentId}?limit=${limit || 100}`),
  searchMessages: (agentId, query) => request(`/api/chat/${agentId}/search?q=${encodeURIComponent(query)}`),

  // Settings
  getSettings: () => request('/api/settings'),
  updateSettings: (data) => request('/api/settings', { method: 'PUT', body: JSON.stringify(data) }),
  getProviderAuth: () => request('/api/settings/provider-auth'),
  saveAnthropicSetupToken: (token) =>
    request('/api/settings/provider-auth/anthropic/setup-token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  importCodexOAuth: () =>
    request('/api/settings/provider-auth/openai-codex/import', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  importGeminiOAuth: (projectId) =>
    request('/api/settings/provider-auth/google-gemini-cli/import', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId || '' }),
    }),
  clearProviderAuth: (provider) =>
    request(`/api/settings/provider-auth/${provider}`, { method: 'DELETE' }),
  getBudget: () => request('/api/settings/budget'),
  getBudgetHistory: (days) => request(`/api/settings/budget/history?days=${days || 30}`),
  getBudgetByAgent: (days) => request(`/api/settings/budget/by-agent?days=${days || 30}`),
  getBudgetByModel: (days) => request(`/api/settings/budget/by-model?days=${days || 30}`),

  // Plugins
  getPlugins: () => request('/api/settings/plugins'),

  // Files
  readFile: (path) => request(`/api/files/read?path=${encodeURIComponent(path)}`),
  writeFile: (path, content) => request('/api/files/write', { method: 'POST', body: JSON.stringify({ path, content }) }),
  browseFolder: () => request('/api/files/browse-folder'),

  // Templates
  getTemplates: () => request('/api/templates'),
  createTemplate: (data) => request('/api/templates', { method: 'POST', body: JSON.stringify(data) }),
  useTemplate: (id, overrides) => request(`/api/templates/${id}/use`, { method: 'POST', body: JSON.stringify(overrides || {}) }),
  deleteTemplate: (id) => request(`/api/templates/${id}`, { method: 'DELETE' }),

  // Export
  getUsageReport: (days) => request(`/api/settings/report?days=${days || 30}`),
  exportData: (type) => request(`/api/settings/export?type=${type || 'all'}`),

  // Rooms (Group Chat)
  getRooms: () => request('/api/rooms'),
  createRoom: (data) => request('/api/rooms', { method: 'POST', body: JSON.stringify(data) }),
  getRoomMessages: (id, limit) => request(`/api/rooms/${id}/messages?limit=${limit || 200}`),
  sendRoomMessage: (id, content) => request(`/api/rooms/${id}/messages`, { method: 'POST', body: JSON.stringify({ content }) }),
  deleteRoom: (id) => request(`/api/rooms/${id}`, { method: 'DELETE' }),

  // Pipelines
  getPipelines: () => request('/api/pipelines'),
  getPipeline: (id) => request(`/api/pipelines/${id}`),
  createPipeline: (data) => request('/api/pipelines', { method: 'POST', body: JSON.stringify(data) }),
  updatePipeline: (id, data) => request(`/api/pipelines/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePipeline: (id) => request(`/api/pipelines/${id}`, { method: 'DELETE' }),
  runPipeline: (id) => request(`/api/pipelines/${id}/run`, { method: 'POST' }),

  // Custom Tools
  getCustomTools: () => request('/api/tools'),
  createCustomTool: (data) => request('/api/tools', { method: 'POST', body: JSON.stringify(data) }),
  deleteCustomTool: (id) => request(`/api/tools/${id}`, { method: 'DELETE' }),

  // Status
  getStatus: () => request('/api/status'),

  // Auth
  checkAuth: () => fetch('/api/auth/check', {
    headers: { ...getAuthHeaders() },
  }).then(r => r.json()),
  login: (password) => fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  }).then(r => r.json()),
};
