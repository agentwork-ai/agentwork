const fs = require('fs');
const os = require('os');
const path = require('path');
const { db, uuidv4, logAudit } = require('../db');
const {
  createCompletion,
  estimateCost,
  chatWithClaudeAgent,
  chatWithCodexAgent,
  createCodexClient,
} = require('./ai');
const { buildAgentContext, buildChatSystemPrompt } = require('./agent-context');

const activeMeetings = new Map();
const meetingRuntimeSessions = new Map();

const MODE_DEFINITIONS = {
  rapid: {
    id: 'rapid',
    label: 'Rapid Alignment',
    rounds: 1,
    discussionStyle: 'Keep the discussion fast and practical. Focus on scope, major constraints, and the minimum task breakdown needed to move.',
  },
  working: {
    id: 'working',
    label: 'Working Session',
    rounds: 2,
    discussionStyle: 'Balance speed with substance. Clarify scope, technical approach, sequencing, risks, and produce an actionable task plan.',
  },
  deep: {
    id: 'deep',
    label: 'Deep Dive',
    rounds: 3,
    discussionStyle: 'Go deep. Stress-test assumptions, edge cases, dependencies, rollout concerns, and produce a thorough task breakdown.',
  },
};

function normalizeMode(value) {
  return value === 'rapid' || value === 'deep' ? value : 'working';
}

function isCodexAgent(agent) {
  return agent?.provider === 'codex-cli'
    || agent?.provider === 'openai-codex'
    || (agent?.auth_type === 'cli' && agent?.provider === 'openai');
}

function usesCliRuntime(agent) {
  return Boolean(agent) && (
    agent.auth_type === 'cli'
    || agent.provider === 'claude-cli'
    || isCodexAgent(agent)
  );
}

function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || '';
}

function resolveConfiguredWorkspaceDir() {
  const configured = String(getSetting('default_workspace') || '').trim();
  if (!configured) return '';

  const resolved = path.resolve(configured);
  try {
    fs.mkdirSync(resolved, { recursive: true });
  } catch {}
  return resolved;
}

function resolveChatWorkingDirectory() {
  return resolveConfiguredWorkspaceDir() || os.homedir() || process.cwd();
}

function parseJsonList(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function hydrateMeetingRow(row) {
  if (!row) return null;
  return {
    ...row,
    agent_ids: parseJsonList(row.agent_ids),
    auto_apply_tasks: Boolean(row.auto_apply_tasks),
    tasks_applied: Boolean(row.tasks_applied),
  };
}

function hydrateMeetingMessage(row) {
  return row ? { ...row } : null;
}

function hydrateMeetingTask(row) {
  return row
    ? {
        ...row,
        suggested_agent_id: row.suggested_agent_id || null,
        created_task_id: row.created_task_id || null,
      }
    : null;
}

function normalizeMeetingAgentIds(agentIds) {
  return Array.from(new Set((agentIds || []).filter(Boolean).map((value) => String(value).trim()).filter(Boolean)));
}

function getMeetingListQuery() {
  return `
    SELECT
      m.*,
      p.name AS project_name,
      a.name AS facilitator_name,
      a.avatar AS facilitator_avatar,
      (SELECT COUNT(*) FROM meeting_messages mm WHERE mm.meeting_id = m.id) AS message_count,
      (SELECT COUNT(*) FROM meeting_tasks mt WHERE mt.meeting_id = m.id) AS task_count,
      (SELECT COUNT(*) FROM meeting_tasks mt WHERE mt.meeting_id = m.id AND mt.created_task_id IS NOT NULL) AS applied_task_count
    FROM meetings m
    LEFT JOIN projects p ON p.id = m.project_id
    LEFT JOIN agents a ON a.id = m.facilitator_agent_id
  `;
}

function getMeetingById(meetingId) {
  const row = db.prepare(`${getMeetingListQuery()} WHERE m.id = ?`).get(meetingId);
  return hydrateMeetingRow(row);
}

function getMeetingMessages(meetingId) {
  return db.prepare(
    'SELECT * FROM meeting_messages WHERE meeting_id = ? ORDER BY created_at ASC, rowid ASC'
  ).all(meetingId).map(hydrateMeetingMessage);
}

function getMeetingTasks(meetingId) {
  return db.prepare(
    `SELECT mt.*, a.name AS suggested_agent_name, a.avatar AS suggested_agent_avatar
     FROM meeting_tasks mt
     LEFT JOIN agents a ON a.id = mt.suggested_agent_id
     WHERE mt.meeting_id = ?
     ORDER BY mt.sort_order ASC, mt.created_at ASC`
  ).all(meetingId).map(hydrateMeetingTask);
}

function getMeetingDetail(meetingId) {
  const meeting = getMeetingById(meetingId);
  if (!meeting) return null;
  return {
    ...meeting,
    messages: getMeetingMessages(meetingId),
    proposed_tasks: getMeetingTasks(meetingId),
  };
}

function listMeetings(projectId = '') {
  const rows = projectId
    ? db.prepare(`${getMeetingListQuery()} WHERE m.project_id = ? ORDER BY m.updated_at DESC, m.created_at DESC`).all(projectId)
    : db.prepare(`${getMeetingListQuery()} ORDER BY m.updated_at DESC, m.created_at DESC`).all();
  return rows.map(hydrateMeetingRow);
}

function getAgentsByIds(agentIds) {
  const ids = Array.from(new Set((agentIds || []).filter(Boolean)));
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM agents WHERE id IN (${placeholders})`).all(...ids);
}

function chooseFacilitator(agents) {
  if (!agents.length) return null;

  const scoreRole = (agent) => {
    const role = String(agent.role || '').toLowerCase();
    const rules = [
      ['ceo', 120],
      ['project manager', 115],
      ['product manager', 112],
      ['business analyst', 110],
      ['product owner', 108],
      ['tech lead', 104],
      ['technical lead', 104],
      ['cto', 102],
      ['engineering manager', 100],
      ['assistant', 98],
      ['architect', 96],
      ['manager', 94],
    ];

    for (const [needle, score] of rules) {
      if (role.includes(needle)) return score;
    }
    return 50;
  };

  return [...agents].sort((a, b) => scoreRole(b) - scoreRole(a))[0];
}

function buildRoundOrder(agents, facilitatorId, roundIndex, totalRounds) {
  if (agents.length <= 1) return agents;
  const facilitator = agents.find((agent) => agent.id === facilitatorId);
  const others = agents.filter((agent) => agent.id !== facilitatorId);

  if (!facilitator) return agents;
  if (roundIndex === 0) return [facilitator, ...others];
  if (roundIndex === totalRounds - 1) return [...others, facilitator];
  return [...others, facilitator];
}

function readProjectDoc(projectPath) {
  if (!projectPath) return '';
  const docPath = path.join(projectPath, 'PROJECT.md');
  try {
    if (!fs.existsSync(docPath)) return '';
    const content = fs.readFileSync(docPath, 'utf8');
    return content.length > 5000 ? `${content.slice(0, 5000)}\n\n[PROJECT.md truncated]` : content;
  } catch {
    return '';
  }
}

function getRecentProjectTasks(projectId) {
  if (!projectId) return [];
  return db.prepare(
    'SELECT title, status, priority FROM tasks WHERE project_id = ? ORDER BY updated_at DESC LIMIT 12'
  ).all(projectId);
}

function buildProjectContext(project) {
  if (!project) return 'No project context is attached.';
  const lines = [
    `Project: ${project.name}`,
    project.description ? `Description: ${project.description}` : '',
  ].filter(Boolean);

  const projectDoc = readProjectDoc(project.path);
  if (projectDoc) {
    lines.push(`PROJECT.md:\n${projectDoc}`);
  }

  const recentTasks = getRecentProjectTasks(project.id);
  if (recentTasks.length > 0) {
    lines.push(
      `Current board snapshot:\n${recentTasks.map((task) => `- [${task.status}] ${task.title} (${task.priority})`).join('\n')}`
    );
  }

  return lines.join('\n\n');
}

function formatTranscript(messages, limit = 18) {
  const visible = messages.slice(-limit);
  return visible.map((message) => `${message.speaker_name || 'System'}: ${message.content}`).join('\n\n');
}

function estimateAndLogBudget(agent, response) {
  const inputTokens = response?.inputTokens || 0;
  const outputTokens = response?.outputTokens || 0;
  if (!inputTokens && !outputTokens) return;

  const cost = estimateCost(agent.provider, agent.model, inputTokens, outputTokens);
  db.prepare(
    'INSERT INTO budget_logs (id, agent_id, provider, model, input_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(uuidv4(), agent.id, agent.provider, agent.model, inputTokens, outputTokens, cost);
}

function normalizePriority(priority) {
  const normalized = String(priority || '').trim().toLowerCase();
  if (normalized === 'critical' || normalized === 'high' || normalized === 'low') return normalized;
  return 'medium';
}

function parseJsonResponse(raw) {
  const candidates = [];
  const fenced = String(raw || '').match(/```json\s*([\s\S]*?)```/i) || String(raw || '').match(/```\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const firstBrace = String(raw || '').indexOf('{');
  const lastBrace = String(raw || '').lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(String(raw || '').slice(firstBrace, lastBrace + 1));
  }

  candidates.push(String(raw || '').trim());

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {}
  }

  return null;
}

function resolveSuggestedAgent(taskLike, agents) {
  const byId = String(taskLike.suggested_agent_id || '').trim();
  if (byId && agents.some((agent) => agent.id === byId)) return byId;

  const name = String(
    taskLike.suggested_agent_name
    || taskLike.owner
    || taskLike.owner_name
    || taskLike.assignee
    || ''
  ).trim().toLowerCase();

  if (!name) return null;
  const matched = agents.find((agent) => String(agent.name || '').trim().toLowerCase() === name);
  return matched?.id || null;
}

function normalizePlannedTasks(parsed, agents, rawText, topic) {
  const taskSource = Array.isArray(parsed?.tasks)
    ? parsed.tasks
    : Array.isArray(parsed?.task_list)
      ? parsed.task_list
      : [];

  const normalized = taskSource
    .map((taskLike, index) => {
      const title = String(taskLike.title || taskLike.task || taskLike.name || '').trim();
      if (!title) return null;

      return {
        title,
        description: String(taskLike.description || taskLike.details || taskLike.scope || '').trim(),
        priority: normalizePriority(taskLike.priority),
        owner_hint: String(
          taskLike.owner_hint
          || taskLike.owner
          || taskLike.suggested_owner
          || taskLike.suggested_agent_name
          || taskLike.role_hint
          || ''
        ).trim(),
        rationale: String(taskLike.rationale || taskLike.reason || taskLike.why || '').trim(),
        suggested_agent_id: resolveSuggestedAgent(taskLike, agents),
        sort_order: index,
      };
    })
    .filter(Boolean);

  if (normalized.length > 0) return normalized;

  const fallbackLines = String(rawText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim())
    .filter(Boolean)
    .slice(0, 8);

  return fallbackLines.map((title, index) => ({
    title,
    description: '',
    priority: 'medium',
    owner_hint: '',
    rationale: `Derived from the meeting output for "${topic}".`,
    suggested_agent_id: null,
    sort_order: index,
  }));
}

function buildTaskDescription(proposedTask, meeting) {
  const sections = [proposedTask.description || ''];
  sections.push(`Planned from meeting: ${meeting.topic}`);
  if (meeting.goal) sections.push(`Meeting goal: ${meeting.goal}`);
  if (proposedTask.owner_hint) sections.push(`Suggested owner: ${proposedTask.owner_hint}`);
  if (proposedTask.rationale) sections.push(`Why this task exists: ${proposedTask.rationale}`);
  return sections.filter(Boolean).join('\n\n');
}

function resolveMeetingTaskAgentId(project, proposedTask) {
  if (proposedTask.suggested_agent_id) return proposedTask.suggested_agent_id;
  return project?.project_manager_agent_id || project?.default_agent_id || null;
}

function clearMeetingRuntimeSessions(meetingId) {
  for (const key of meetingRuntimeSessions.keys()) {
    if (key.startsWith(`${meetingId}:`)) {
      meetingRuntimeSessions.delete(key);
    }
  }
}

function emitMeetingUpdated(io, meetingId) {
  if (!io) return;
  const meeting = getMeetingById(meetingId);
  if (meeting) io.emit('meeting:updated', meeting);
}

function insertMeetingMessage(meetingId, speakerType, speakerId, speakerName, content, roundIndex, io) {
  const id = uuidv4();
  db.prepare(
    `INSERT INTO meeting_messages (id, meeting_id, speaker_type, speaker_id, speaker_name, content, round_index)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, meetingId, speakerType, speakerId || null, speakerName || '', content, roundIndex ?? 0);

  const message = db.prepare('SELECT * FROM meeting_messages WHERE id = ?').get(id);
  if (io) io.emit('meeting:message', { meetingId, message });
  return hydrateMeetingMessage(message);
}

function loadMeetingParticipants(agentIds) {
  const agents = getAgentsByIds(agentIds);
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  return (agentIds || []).map((agentId) => byId.get(agentId)).filter(Boolean);
}

function getMeetingMode(meeting) {
  return MODE_DEFINITIONS[normalizeMode(meeting.mode)];
}

function buildMeetingTurnPrompts(agent, meeting, project, transcriptMessages, participants, facilitator, roundIndex) {
  const mode = getMeetingMode(meeting);
  const agentContext = buildAgentContext(agent.id, agent, { includeMemory: true, includeHeartbeat: false });
  const participantLine = participants.map((participant) => `${participant.name} (${participant.role})`).join(', ');
  const projectContext = buildProjectContext(project);
  const transcript = formatTranscript(transcriptMessages);

  const systemPrompt = [
    buildChatSystemPrompt(agent, agentContext),
    `## Internal Meeting
You are participating in an internal planning meeting with other agents.
Meeting mode: ${mode.label}
Topic: ${meeting.topic}
Goal: ${meeting.goal || 'No additional goal provided.'}
Participants: ${participantLine}
Facilitator: ${facilitator ? `${facilitator.name} (${facilitator.role})` : 'Not assigned'}
${mode.discussionStyle}
Keep each turn concise but substantive. Speak like a professional teammate, not like a chatbot.`,
  ].join('\n\n');

  const userPrompt = [
    `Project context:\n${projectContext}`,
    transcript ? `Transcript so far:\n${transcript}` : 'Transcript so far:\n(No one has spoken yet.)',
    `You are speaking in round ${roundIndex + 1} of ${mode.rounds}.`,
    facilitator?.id === agent.id && roundIndex === mode.rounds - 1
      ? 'As facilitator, steer the conversation toward concrete scope, sequencing, and actionable tasks.'
      : 'Add new value. Clarify scope, challenge weak assumptions, call out dependencies, or sharpen execution details.',
    'Respond with one turn only. No headers. No role labels. No JSON.',
  ].join('\n\n');

  return { systemPrompt, userPrompt };
}

async function generateAgentTurn(agent, systemPrompt, userPrompt, sessionKey) {
  if (usesCliRuntime(agent)) {
    const workDir = resolveChatWorkingDirectory();
    const prompt = `${systemPrompt}\n\n${userPrompt}`;

    if (agent.provider === 'anthropic' || agent.provider === 'claude-cli') {
      const session = meetingRuntimeSessions.get(sessionKey);
      const result = await chatWithClaudeAgent(prompt, session?.sessionId || null, workDir);
      meetingRuntimeSessions.set(sessionKey, { sessionId: result.sessionId });
      if (!result.content?.trim()) {
        throw new Error('Claude completed without returning a response.');
      }
      return { content: result.content };
    }

    if (isCodexAgent(agent)) {
      let Codex;
      try {
        ({ Codex } = await import('@openai/codex-sdk'));
      } catch (importErr) {
        throw new Error(`Failed to load Codex SDK: ${importErr.message}.`);
      }

      let session = meetingRuntimeSessions.get(sessionKey);
      if (!session?.thread) {
        const client = createCodexClient(Codex);
        session = {
          thread: client.startThread({
            workingDirectory: workDir,
            approvalPolicy: 'never',
            sandboxMode: 'danger-full-access',
          }),
        };
        meetingRuntimeSessions.set(sessionKey, session);
      }

      const result = await chatWithCodexAgent(prompt, session.thread);
      if (!result.content?.trim()) {
        throw new Error('Codex completed without returning a response.');
      }
      return { content: result.content };
    }

    throw new Error(`Unsupported CLI runtime for provider "${agent.provider}".`);
  }

  const response = await createCompletion(
    agent.provider,
    agent.model,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    agent.fallback_model ? { fallbackModel: agent.fallback_model } : {},
  );

  if (!response.content?.trim()) {
    throw new Error(`${agent.name} completed without returning a response.`);
  }

  return response;
}

async function synthesizeMeetingPlan(meeting, project, transcriptMessages, participants, facilitator) {
  const agent = facilitator || participants[0];
  if (!agent) throw new Error('No facilitator available for task synthesis.');

  const mode = getMeetingMode(meeting);
  const agentContext = buildAgentContext(agent.id, agent, { includeMemory: true, includeHeartbeat: false });
  const projectContext = buildProjectContext(project);
  const transcript = formatTranscript(transcriptMessages, 28);
  const participantLine = participants.map((participant) => `${participant.name} (${participant.role})`).join(', ');

  const systemPrompt = [
    buildChatSystemPrompt(agent, agentContext),
    `## Meeting Wrap-Up
You are closing an internal planning meeting and must turn the discussion into an actionable task plan.
Meeting mode: ${mode.label}
Topic: ${meeting.topic}
Goal: ${meeting.goal || 'No additional goal provided.'}
Participants: ${participantLine}
Return valid JSON only.`,
  ].join('\n\n');

  const userPrompt = [
    `Project context:\n${projectContext}`,
    `Transcript:\n${transcript}`,
    `Return JSON with this shape:
{
  "summary": "short synthesis of the conclusion",
  "tasks": [
    {
      "title": "clear actionable task title",
      "description": "enough detail to put directly on the board",
      "priority": "critical|high|medium|low",
      "owner_hint": "best-fit role or person, optional",
      "rationale": "why this task matters",
      "suggested_agent_id": "agent id if you know an exact agent, optional",
      "suggested_agent_name": "agent name if relevant, optional"
    }
  ]
}
Rules:
- Produce between 3 and 12 tasks when the topic warrants it.
- Task titles must be board-ready and non-duplicative.
- Prefer tasks that are small enough to execute but large enough to matter.
- If the discussion is too vague for execution, create the necessary discovery/specification tasks first.`,
  ].join('\n\n');

  const response = await generateAgentTurn(agent, systemPrompt, userPrompt, `${meeting.id}:summary:${agent.id}`);
  estimateAndLogBudget(agent, response);
  const parsed = parseJsonResponse(response.content);
  const tasks = normalizePlannedTasks(parsed, participants, response.content, meeting.topic);
  const summary = String(parsed?.summary || parsed?.overview || '').trim() || response.content.trim().slice(0, 800);

  return {
    facilitator: agent,
    summary,
    finalReport: response.content.trim(),
    tasks,
  };
}

function storeMeetingTasks(meetingId, tasks) {
  db.prepare('DELETE FROM meeting_tasks WHERE meeting_id = ?').run(meetingId);
  const stmt = db.prepare(
    `INSERT INTO meeting_tasks
      (id, meeting_id, title, description, priority, owner_hint, rationale, suggested_agent_id, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const task of tasks) {
    stmt.run(
      uuidv4(),
      meetingId,
      task.title,
      task.description || '',
      task.priority || 'medium',
      task.owner_hint || '',
      task.rationale || '',
      task.suggested_agent_id || null,
      task.sort_order ?? 0,
    );
  }
}

function applyMeetingTasks(meetingId, io) {
  const meeting = getMeetingById(meetingId);
  if (!meeting) throw new Error('Meeting not found.');
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(meeting.project_id);

  const proposedTasks = getMeetingTasks(meetingId).filter((task) => !task.created_task_id);
  if (proposedTasks.length === 0) {
    db.prepare(
      `UPDATE meetings
       SET tasks_applied = 1, status = 'completed', updated_at = CURRENT_TIMESTAMP,
           completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
       WHERE id = ?`
    ).run(meetingId);
    emitMeetingUpdated(io, meetingId);
    return getMeetingDetail(meetingId);
  }

  const createdTaskIds = [];
  for (const proposedTask of proposedTasks) {
    const taskId = uuidv4();
    const assignedAgentId = resolveMeetingTaskAgentId(project, proposedTask);
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, priority, agent_id, project_id, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      taskId,
      proposedTask.title,
      buildTaskDescription(proposedTask, meeting),
      'backlog',
      normalizePriority(proposedTask.priority),
      assignedAgentId,
      meeting.project_id,
      'meeting-plan',
    );

    db.prepare(
      `UPDATE meeting_tasks
       SET created_task_id = ?, status = 'applied'
       WHERE id = ?`
    ).run(taskId, proposedTask.id);

    const task = db.prepare(
      `SELECT t.*, a.name as agent_name, a.avatar as agent_avatar, p.name as project_name
       FROM tasks t
       LEFT JOIN agents a ON t.agent_id = a.id
       LEFT JOIN projects p ON t.project_id = p.id
       WHERE t.id = ?`
    ).get(taskId);

    task.execution_logs = JSON.parse(task.execution_logs || '[]');
    task.attachments = JSON.parse(task.attachments || '[]');
    task.flow_items = JSON.parse(task.flow_items || '[]');
    task.depends_on = JSON.parse(task.depends_on || '[]');

    if (io) io.emit('task:created', task);
    createdTaskIds.push(taskId);
  }

  db.prepare(
    `UPDATE meetings
     SET tasks_applied = 1, status = 'completed', updated_at = CURRENT_TIMESTAMP,
         completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP), error_message = ''
     WHERE id = ?`
  ).run(meetingId);

  insertMeetingMessage(
    meetingId,
    'system',
    null,
    'System',
    `Added ${createdTaskIds.length} task${createdTaskIds.length === 1 ? '' : 's'} to the project board.`,
    999,
    io,
  );

  logAudit('apply', 'meeting_tasks', meetingId, { created_task_ids: createdTaskIds });
  emitMeetingUpdated(io, meetingId);
  return getMeetingDetail(meetingId);
}

async function runMeeting(meetingId, io) {
  const meeting = getMeetingById(meetingId);
  if (!meeting) throw new Error('Meeting not found.');

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(meeting.project_id);
  const participants = loadMeetingParticipants(meeting.agent_ids);
  if (participants.length === 0) {
    throw new Error('Meeting has no valid agents.');
  }

  const facilitator = chooseFacilitator(participants);
  db.prepare(
    `UPDATE meetings
     SET facilitator_agent_id = ?, status = 'running', error_message = '', summary = '',
         final_report = '', started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(facilitator?.id || null, meetingId);
  emitMeetingUpdated(io, meetingId);

  const mode = getMeetingMode(meeting);
  insertMeetingMessage(
    meetingId,
    'system',
    null,
    'System',
    `Meeting started in ${mode.label} mode for topic "${meeting.topic}". ${facilitator ? `${facilitator.name} is facilitating.` : ''}`.trim(),
    -1,
    io,
  );

  let transcriptMessages = getMeetingMessages(meetingId);

  for (let roundIndex = 0; roundIndex < mode.rounds; roundIndex += 1) {
    const speakingOrder = buildRoundOrder(participants, facilitator?.id, roundIndex, mode.rounds);
    for (const agent of speakingOrder) {
      try {
        const { systemPrompt, userPrompt } = buildMeetingTurnPrompts(
          agent,
          meeting,
          project,
          transcriptMessages,
          participants,
          facilitator,
          roundIndex,
        );

        const response = await generateAgentTurn(
          agent,
          systemPrompt,
          userPrompt,
          `${meetingId}:round:${roundIndex}:${agent.id}`,
        );

        estimateAndLogBudget(agent, response);
        insertMeetingMessage(
          meetingId,
          'agent',
          agent.id,
          agent.name,
          response.content.trim(),
          roundIndex,
          io,
        );
      } catch (err) {
        insertMeetingMessage(
          meetingId,
          'system',
          null,
          'System',
          `${agent.name} could not contribute in round ${roundIndex + 1}: ${err.message}`,
          roundIndex,
          io,
        );
      }

      transcriptMessages = getMeetingMessages(meetingId);
      db.prepare('UPDATE meetings SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(meetingId);
      emitMeetingUpdated(io, meetingId);
    }
  }

  const plan = await synthesizeMeetingPlan(meeting, project, transcriptMessages, participants, facilitator);
  db.prepare(
    `UPDATE meetings
     SET summary = ?, final_report = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(plan.summary, plan.finalReport, meetingId);
  storeMeetingTasks(meetingId, plan.tasks);

  if (plan.tasks.length === 0) {
    db.prepare(
      `UPDATE meetings
       SET status = 'completed', completed_at = CURRENT_TIMESTAMP, error_message = '', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(meetingId);
    insertMeetingMessage(
      meetingId,
      'system',
      null,
      'System',
      'Meeting completed, but no actionable tasks were extracted from the discussion.',
      mode.rounds,
      io,
    );
    emitMeetingUpdated(io, meetingId);
    return;
  }

  if (meeting.auto_apply_tasks) {
    insertMeetingMessage(
      meetingId,
      'system',
      null,
      'System',
      `Meeting produced ${plan.tasks.length} task${plan.tasks.length === 1 ? '' : 's'}. Adding them to the project board automatically.`,
      mode.rounds,
      io,
    );
    applyMeetingTasks(meetingId, io);
    return;
  }

  db.prepare(
    `UPDATE meetings
     SET status = 'awaiting_confirmation', tasks_applied = 0, completed_at = CURRENT_TIMESTAMP,
         error_message = '', updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(meetingId);
  insertMeetingMessage(
    meetingId,
    'system',
    null,
    'System',
    `Meeting produced ${plan.tasks.length} task${plan.tasks.length === 1 ? '' : 's'}. Waiting for approval to add them to the project board.`,
    mode.rounds,
    io,
  );
  emitMeetingUpdated(io, meetingId);
}

async function startMeeting(meetingId, io) {
  const meeting = getMeetingById(meetingId);
  if (!meeting) throw new Error('Meeting not found.');

  if (activeMeetings.has(meetingId)) {
    return getMeetingDetail(meetingId);
  }

  if (!['draft', 'failed'].includes(meeting.status)) {
    if (meeting.status === 'running') return getMeetingDetail(meetingId);
    throw new Error(`Only draft or failed meetings can be started. Current status: ${meeting.status}`);
  }

  db.prepare('DELETE FROM meeting_messages WHERE meeting_id = ?').run(meetingId);
  db.prepare('DELETE FROM meeting_tasks WHERE meeting_id = ?').run(meetingId);
  clearMeetingRuntimeSessions(meetingId);
  db.prepare(
    `UPDATE meetings
     SET status = 'running', summary = '', final_report = '', error_message = '',
         tasks_applied = 0, facilitator_agent_id = NULL, started_at = CURRENT_TIMESTAMP,
         completed_at = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(meetingId);
  emitMeetingUpdated(io, meetingId);

  const runPromise = runMeeting(meetingId, io)
    .catch((err) => {
      db.prepare(
        `UPDATE meetings
         SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(err.message, meetingId);
      insertMeetingMessage(meetingId, 'system', null, 'System', `Meeting failed: ${err.message}`, 999, io);
      emitMeetingUpdated(io, meetingId);
    })
    .finally(() => {
      clearMeetingRuntimeSessions(meetingId);
      activeMeetings.delete(meetingId);
    });

  activeMeetings.set(meetingId, runPromise);
  return getMeetingDetail(meetingId);
}

function createMeeting(data, io) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(data.project_id);
  if (!project) throw new Error('Project not found.');

  const topic = String(data.topic || '').trim();
  if (!topic) throw new Error('Topic is required.');

  const agentIds = normalizeMeetingAgentIds(data.agent_ids);
  if (agentIds.length === 0) throw new Error('Select at least one agent.');

  const participants = getAgentsByIds(agentIds);
  if (participants.length === 0) throw new Error('No valid meeting agents were selected.');
  const participantIds = new Set(participants.map((agent) => agent.id));
  const validAgentIds = agentIds.filter((agentId) => participantIds.has(agentId));

  const id = uuidv4();
  db.prepare(
    `INSERT INTO meetings
      (id, project_id, topic, goal, status, mode, agent_ids, auto_apply_tasks)
     VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`
  ).run(
    id,
    data.project_id,
    topic,
    String(data.goal || '').trim(),
    normalizeMode(data.mode),
    JSON.stringify(validAgentIds),
    data.auto_apply_tasks ? 1 : 0,
  );

  const meeting = getMeetingById(id);
  logAudit('create', 'meeting', id, {
    topic,
    project_id: data.project_id,
    agent_ids: validAgentIds,
    auto_apply_tasks: Boolean(data.auto_apply_tasks),
  });
  if (io) io.emit('meeting:created', meeting);
  return meeting;
}

function updateMeeting(meetingId, data, io) {
  const existing = getMeetingById(meetingId);
  if (!existing) throw new Error('Meeting not found.');
  if (existing.status === 'running') throw new Error('Cannot edit a meeting while it is running.');

  const topic = String(data.topic ?? existing.topic).trim();
  if (!topic) throw new Error('Topic is required.');

  const goal = String(data.goal ?? existing.goal).trim();
  const projectId = data.project_id || existing.project_id;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) throw new Error('Project not found.');

  const nextAgentIds = normalizeMeetingAgentIds(
    Array.isArray(data.agent_ids) ? data.agent_ids : existing.agent_ids
  );
  if (nextAgentIds.length === 0) throw new Error('Select at least one agent.');
  const participants = getAgentsByIds(nextAgentIds);
  if (participants.length === 0) throw new Error('No valid meeting agents were selected.');
  const participantIds = new Set(participants.map((agent) => agent.id));
  const validAgentIds = nextAgentIds.filter((agentId) => participantIds.has(agentId));

  db.prepare(
    `UPDATE meetings
     SET project_id = ?, topic = ?, goal = ?, mode = ?, agent_ids = ?, auto_apply_tasks = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(
    projectId,
    topic,
    goal,
    normalizeMode(data.mode ?? existing.mode),
    JSON.stringify(validAgentIds),
    data.auto_apply_tasks !== undefined ? (data.auto_apply_tasks ? 1 : 0) : (existing.auto_apply_tasks ? 1 : 0),
    meetingId,
  );

  const updated = getMeetingById(meetingId);
  logAudit('update', 'meeting', meetingId, {
    topic,
    project_id: projectId,
    agent_ids: validAgentIds,
  });
  if (io) io.emit('meeting:updated', updated);
  return updated;
}

function deleteMeeting(meetingId, io) {
  const meeting = getMeetingById(meetingId);
  if (!meeting) throw new Error('Meeting not found.');
  if (meeting.status === 'running') throw new Error('Stop the running meeting before deleting it.');

  db.prepare('DELETE FROM meetings WHERE id = ?').run(meetingId);
  logAudit('delete', 'meeting', meetingId, { topic: meeting.topic });
  if (io) io.emit('meeting:deleted', { id: meetingId });
  return { success: true };
}

module.exports = {
  MODE_DEFINITIONS,
  normalizeMode,
  listMeetings,
  getMeetingDetail,
  createMeeting,
  updateMeeting,
  deleteMeeting,
  startMeeting,
  applyMeetingTasks,
};
