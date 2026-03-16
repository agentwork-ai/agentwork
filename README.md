# AgentWork

Autonomous AI agent orchestration platform. Hire, manage, and collaborate with multiple AI agents through a real-time dashboard — agents execute tasks, chat over Telegram/Slack, and run on schedules, all in the background.

## Quick Start

```bash
git clone https://github.com/your-org/agentwork.git
cd agentwork
npm install
npm run dev
```

Open [http://localhost:1248](http://localhost:1248)

## Features

- **Multi-Agent** — Hire agents with distinct roles, models, and persistent memory
- **Kanban Board** — Drag tasks to "Doing" and agents execute autonomously
- **Flow Tasks** — Chain multiple agents in sequential multi-step workflows
- **8 AI Providers** — Anthropic, OpenAI, OpenRouter, DeepSeek, Mistral, Google, Ollama, LMStudio
- **80+ Models** — Claude 4, GPT-5, Gemini 2.5, DeepSeek V3, Codestral, and more
- **CLI + API Auth** — Use API keys or local Claude Code / Codex CLI auth
- **Agent Memory** — OpenClaw architecture: SOUL.md, USER.md, AGENTS.md, MEMORY.md per agent
- **Platform Chat** — Telegram and Slack bot integration per agent
- **Task Scheduling** — One-shot timestamps and recurring cron expressions
- **Budget Controls** — Daily/monthly USD limits with automatic enforcement
- **Live Telemetry** — "The Office" view shows real-time agent activity
- **Dark/Light Mode** — System-aware theme switching

## Architecture

```
Node.js daemon (port 1248)
├── Express REST API        /api/projects, /api/tasks, /api/agents, /api/chat, /api/settings
├── Socket.io               Real-time task updates, execution logs, chat, notifications
├── Next.js 14 SSR          Dashboard UI (React 18, Tailwind CSS)
├── SQLite (better-sqlite3)  Local database at ~/.agentwork/db/agentwork.db
└── Services
    ├── executor.js          Task execution via Claude Agent SDK / Codex SDK / API
    ├── scheduler.js         Cron and one-shot task triggers
    ├── platforms.js         Telegram (Telegraf) and Slack (Bolt) bots
    └── ai.js               Multi-provider completion engine with cost tracking
```

## CLI

```bash
agentwork start [-p PORT] [-f]    # Start daemon (default port 1248, -f for foreground)
agentwork stop                    # Graceful shutdown
agentwork status                  # PID, URL, active agents
agentwork logs [-n N] [-f]        # Tail server logs
agentwork clean                   # Clear temp files and logs
```

To install the CLI globally: `npm link`

## Dashboard Pages

| Page | Path | Description |
|------|------|-------------|
| Dashboard | `/` | Stats, task pipeline, recent activity, quick actions |
| Projects | `/projects` | Project CRUD, file explorer, auto-generated PROJECT.md |
| Tasks | `/kanban` | 5-column Kanban board with drag-to-execute |
| Chat | `/chat` | Direct messaging with agents, unblock stuck tasks |
| Office | `/office` | Live agent telemetry visualization |
| Agents | `/agents` | Hire/fire agents, configure memory and platform bots |
| Settings | `/settings` | API keys, budget limits, preferences |

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
3. The agent reads its memory files + PROJECT.md, then executes autonomously
4. Execution logs stream to the UI in real time (thoughts, commands, file changes)
5. On success the task moves to **Done**; on failure it moves to **Blocked** and notifies you
6. Reply in Chat to unblock and resume execution

**Flow tasks** chain multiple steps across different agents sequentially.

## Data Directory

```
~/.agentwork/
├── db/agentwork.db           # SQLite database
├── agents/<id>/              # Per-agent memory
│   ├── SOUL.md               # Personality and behavioral rules
│   ├── USER.md               # User code style preferences
│   ├── AGENTS.md             # Operational safety rules
│   └── MEMORY.md             # Auto-summarized long-term memory
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

API keys are configured in the dashboard Settings page, not via env vars.

## Development

```bash
npm run dev       # Dev server with hot reload
npm run build     # Production build
npm start         # Production server
npm run lint      # ESLint
```

## Tech Stack

Next.js 14 &middot; React 18 &middot; Tailwind CSS &middot; Express &middot; Socket.io &middot; SQLite &middot; Anthropic SDK &middot; Claude Agent SDK &middot; OpenAI SDK &middot; Codex SDK &middot; Telegraf &middot; Slack Bolt &middot; node-cron &middot; Framer Motion &middot; dnd-kit

## License

MIT
