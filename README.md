# AgentWork

Autonomous AI agent orchestration platform. Hire, manage, and collaborate with multiple AI agents through a real-time dashboard — agents execute tasks, chat over Telegram/Slack/Discord, and run on schedules, all in the background.

<table>
  <tr>
    <td align="center"><strong>Kanban Board</strong><br><img src="demo/board.png" width="600" /></td>
    <td align="center"><strong>Task Detail</strong><br><img src="demo/task.png" width="600" /></td>
  </tr>
  <tr>
    <td align="center"><strong>Agent Manager</strong><br><img src="demo/agent.png" width="600" /></td>
    <td align="center"><strong>Agent Chat</strong><br><img src="demo/chat.png" width="600" /></td>
  </tr>
</table>

## Installation

Requires **Node.js 18+**.

### Option 1: npm (recommended)

```bash
npm install -g agentwork
agentwork start
```

### Option 2: From source

```bash
git clone https://github.com/your-org/agentwork.git
cd agentwork
npm install && npm run build && npm link
agentwork start
```

Open **http://localhost:1248** — the onboarding wizard will guide you through setup.

## Features

### Agent Capabilities
- **Multi-Agent** — Hire agents with distinct roles, models, and persistent memory
- **Agent-to-Agent Communication** — Agents can message each other for delegation and review
- **Per-Agent Tool Restrictions** — Whitelist which tools each agent can use
- **Agent Cloning** — Clone an agent's full configuration and memory with one click
- **Multi-Model Fallback** — Automatic fallback to secondary model on API failure
- **Streaming Chat** — Token-by-token streaming responses via Socket.io
- **Context Window Management** — Auto-prunes conversation history to prevent truncation
- **Agent Warm-Up Cache** — Pre-loads memory files for faster task startup
- **Vision / Image Support** — Agents can analyze images via the `read_image` tool
- **Self-Improving Prompts** — Track success/failure rates with prompt improvement suggestions

### Task Management
- **5-Column Kanban** — Drag tasks to "Doing" and agents execute autonomously
- **Flow Tasks** — Sequential or parallel multi-step workflows across agents
- **Task Dependencies** — DAG-based execution — tasks wait for dependencies to complete
- **Sub-Tasks** — Nested tasks with parent-child relationships
- **Task Templates** — Save and reuse task blueprints
- **Task Labels/Tags** — Free-form tagging for filtering and grouping
- **Bulk Operations** — Multi-select for bulk status change, assign, or delete
- **Priority Queue** — Auto-start next highest-priority task when one finishes
- **Task Scheduling** — One-shot timestamps and recurring cron expressions
- **Retry Blocked Tasks** — Edit description and one-click retry
- **Task Comments** — Discussion threads separate from execution logs
- **Swimlanes** — Group Kanban by agent, project, or priority
- **Time Estimates & SLA** — Track estimated vs actual execution duration

### Git Automation (enabled by default)
- **Auto Branch** — Creates `agentwork/<task-slug>` branch before each task
- **Auto Sync** — Pulls latest from main before starting, auto-resolves conflicts
- **Auto Commit + PR** — Stages, commits, pushes, and opens PR via `gh` CLI
- **Auto Merge** — Squash-merges to main (via PR or local merge as fallback)
- **Auto Init** — Initializes git repo for projects that don't have one

### AI Providers
- **9 Providers** — Anthropic, OpenAI, OpenRouter, DeepSeek, Mistral, Google, Ollama, LMStudio, Custom
- **80+ Models** — Claude 4, GPT-5, Gemini 2.5, DeepSeek V3, Codestral, and more
- **CLI + API Auth** — Use API keys or local Claude Code / Codex CLI (no key needed)
- **Custom Tools** — Define your own tools with bash command templates

### Security
- **Dashboard Authentication** — Optional password protection
- **API Key Encryption** — AES-256-GCM encryption at rest
- **Command Sandboxing** — Blocks dangerous commands, enforces directory jail
- **Path Traversal Protection** — File API restricted to project directories
- **Audit Logging** — All CRUD operations logged with timestamps
- **Per-Agent Budget Limits** — Individual daily spend caps

### Integrations
- **Telegram Bot** — Chat with agents via Telegram
- **Slack Bot** — DMs and @mentions via Socket Mode
- **Discord Bot** — Chat with agents via Discord (requires discord.js)
- **GitHub** — Auto-create issues from blocked tasks, PRs from completed tasks
- **Linear / Jira** — Bidirectional task sync
- **Email Notifications** — SMTP-based alerts for task completion/blocked
- **Webhooks** — Inbound `POST /api/webhooks/trigger` for CI/CD
- **MCP Server** — Expose tasks/agents/projects to Claude Desktop
- **VS Code Extension** — Status, task creation, agent listing from editor
- **Plugin System** — Third-party tools, hooks, and integrations

### UI/UX
- **Dark/Light Mode** — System-aware with 6 accent color presets
- **Markdown Rendering** — Rich formatting in chat and task details
- **Syntax-Highlighted Code Viewer** — JS/TS/Python/JSON/CSS/Markdown
- **In-Line File Editor** — Edit and save files from the dashboard
- **Diff Viewer** — Unified diff with color-coded added/removed lines
- **Keyboard Shortcuts** — Cmd+K, Cmd+1-7, ? for help overlay
- **Execution Log Filtering** — Type filters, text search, color-coding
- **Live Activity Feed** — Real-time event stream on dashboard
- **Onboarding Wizard** — Guided 4-step setup for first-time users
- **Responsive Mobile Layout** — Hamburger menu, compact bottom bar
- **PWA Support** — Installable as mobile app with service worker
- **Analytics Dashboard** — Spend charts, agent utilization, model comparison

## Architecture

```
Node.js daemon (port 1248)
├── Express REST API        50+ endpoints across 10 route files
├── Socket.io               Real-time task updates, execution logs, chat, streaming
├── Next.js 14 SSR          Dashboard UI (React 18, Tailwind CSS) — 10 pages
├── SQLite (better-sqlite3)  Local database with versioned migrations
└── Services
    ├── executor.js          Task execution with concurrency queue, git automation
    ├── scheduler.js         Cron and one-shot task triggers
    ├── ai.js                Multi-provider completion + streaming engine
    ├── platforms.js         Telegram, Slack, Discord bots
    ├── rag.js               Keyword-based file retrieval for project context
    ├── github.js            GitHub issue/PR integration
    ├── email.js             SMTP notification service
    ├── plugins.js           Plugin system loader
    └── crypto.js            AES-256-GCM encryption for API keys
```

## CLI

```bash
agentwork start [-p PORT] [-f]    # Start daemon (default port 1248, -f for foreground)
agentwork stop                    # Graceful shutdown
agentwork status                  # PID, URL, active agents
agentwork logs [-n N] [-f]        # Tail server logs
agentwork clean                   # Clear temp files and logs
agentwork task list [--status S]  # List tasks with optional filter
agentwork task create <title>     # Create task (--description, --priority, --agent)
agentwork agent list              # List all agents with status
```

To install the CLI globally: `npm link`

## Dashboard Pages

| Page | Path | Description |
|------|------|-------------|
| Dashboard | `/` | Stats, live activity feed, task pipeline, quick actions |
| Projects | `/projects` | Project CRUD, file explorer with search, syntax highlighting, inline editor |
| Tasks | `/kanban` | 5-column Kanban with swimlanes, bulk ops, dependencies, templates |
| Chat | `/chat` | Markdown-rendered messaging with search, export, streaming |
| Office | `/office` | Live agent telemetry + execution timeline / Gantt chart |
| Analytics | `/analytics` | Spend charts, agent performance, model comparison |
| Agents | `/agents` | Hire/fire/clone agents, memory editor, tool restrictions, platform bots |
| Settings | `/settings` | API keys, budget, git behavior, security, templates, preferences |

## AI Providers

| Provider | Auth | Example Models |
|----------|------|---------------|
| Anthropic | API key | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5 |
| OpenAI | API key | gpt-5, gpt-4o, o3, o4-mini |
| OpenRouter | API key | 200+ models |
| DeepSeek | API key | deepseek-chat (V3), deepseek-reasoner (R1) |
| Mistral | API key | mistral-large, codestral |
| Google | API key | gemini-2.5-pro, gemini-2.5-flash |
| Ollama / LMStudio | Custom URL | Any local model |
| Claude Code / Codex | CLI auth | No API key needed |

## Task Execution

1. Create a task on the Kanban board and assign an agent + project
2. Drag the task to **Doing** (or set a schedule/cron trigger)
3. Git automation kicks in: sync from main → create feature branch
4. The agent reads its memory files + PROJECT.md + recent project activity
5. Execution logs stream to the UI in real time (thoughts, commands, file changes)
6. On success: auto-commit → push → PR → merge to main → task moves to **Done**
7. On failure: task moves to **Blocked** → retry with modified description
8. Next queued task for the same agent auto-starts

**Flow tasks** chain multiple steps across different agents, sequentially or in parallel.

## Data Directory

```
~/.agentwork/
├── db/agentwork.db           # SQLite database (encrypted API keys)
├── agents/<id>/              # Per-agent memory
│   ├── SOUL.md               # Personality and behavioral rules
│   ├── USER.md               # User code style preferences
│   ├── AGENTS.md             # Operational safety rules
│   ├── MEMORY.md             # Auto-summarized long-term memory
│   └── *.md                  # Custom memory files
├── TEAM.md                   # Shared memory across all agents
├── plugins/                  # Third-party plugins
├── logs/agentwork.log        # Server logs
└── agentwork.pid             # Daemon PID
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `1248` | Server port |
| `NODE_ENV` | `development` | `production` for optimized builds |
| `AGENTWORK_DATA` | `~/.agentwork` | Data directory path |
| `AGENTWORK_ROOT` | Auto-detected | Project source root |
| `AGENTWORK_SETTING_*` | — | Override any setting (e.g., `AGENTWORK_SETTING_ANTHROPIC_API_KEY`) |

## Development

```bash
npm run dev           # Dev server with hot reload
npm run build         # Production build
npm start             # Production server
```

## API Documentation

`GET /api/docs` returns a JSON listing of all 50+ API endpoints.

Key endpoints:
- `/api/tasks` — Task CRUD, bulk operations, subtasks, comments, replay
- `/api/agents` — Agent CRUD, clone, metrics, prompt analysis, inbox
- `/api/projects` — Project CRUD, file search, git status, diff, health score
- `/api/settings` — Settings, budget, cost breakdown, reports, export, audit logs
- `/api/templates` — Task template CRUD
- `/api/tools` — Custom tool CRUD
- `/api/rooms` — Group chat rooms
- `/api/webhooks/trigger` — External task trigger
- `/api/health` — System health check

## Tech Stack

Next.js 14 · React 18 · Tailwind CSS · Express · Socket.io · SQLite · Anthropic SDK · Claude Agent SDK · OpenAI SDK · Codex SDK · Telegraf · Slack Bolt · node-cron · Framer Motion · dnd-kit

## License

MIT
