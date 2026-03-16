# AgentWork

**AgentWork** is a fully autonomous AI agent orchestration platform that runs locally as a background daemon. It lets you hire, manage, and collaborate with multiple AI agents simultaneously — each with their own memory, personality, role, and long-term context — while you monitor everything through a modern real-time dashboard.

Agents can read and write files, execute bash commands, work through multi-step tasks, chat with you over Telegram and Slack, and run on schedules — all while you sleep.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Installation](#installation)
- [CLI Usage](#cli-usage)
- [Dashboard](#dashboard)
  - [Dashboard Home](#dashboard-home)
  - [Projects Workspace](#projects-workspace)
  - [Kanban Task Engine](#kanban-task-engine)
  - [Agent Chat](#agent-chat)
  - [The Office](#the-office)
  - [Agents Manager](#agents-manager)
  - [Settings](#settings)
- [Agents](#agents)
  - [Authentication Modes](#authentication-modes)
  - [Supported AI Providers](#supported-ai-providers)
  - [Supported Models](#supported-models)
  - [OpenClaw Memory Architecture](#openclaw-memory-architecture)
- [Task System](#task-system)
  - [Task Lifecycle](#task-lifecycle)
  - [Task Types](#task-types)
  - [Flow Tasks](#flow-tasks)
  - [Task Scheduling](#task-scheduling)
  - [The YOLO Execution Loop](#the-yolo-execution-loop)
- [Projects](#projects)
  - [PROJECT.md Engine](#projectmd-engine)
  - [File Explorer](#file-explorer)
- [Platform Integrations](#platform-integrations)
  - [Telegram](#telegram)
  - [Slack](#slack)
- [Budget Management](#budget-management)
- [Real-Time System](#real-time-system)
- [Database Schema](#database-schema)
- [Environment Variables](#environment-variables)
- [Configuration Reference](#configuration-reference)
- [Data Directory](#data-directory)
- [Development](#development)

---

## Overview

AgentWork runs as a local Node.js daemon on port `1248`. The frontend is a Next.js dashboard served by the same process. Agents are powered by the Anthropic Claude Agent SDK, OpenAI Codex SDK, or any API-compatible provider (OpenRouter, DeepSeek, Mistral, Google, Ollama, LMStudio).

Each agent gets its own memory directory — a set of markdown files that persist across tasks, accumulate context, and keep the agent grounded in your preferences and your project's architecture. When you assign a task to an agent and move it to **Doing**, the agent wakes up, reads its memory, reads the project's `PROJECT.md`, and executes autonomously — logging every thought, command, and file change in real time.

---

## Features

### Core
- **Background Daemon** — Agents keep working even when the dashboard is closed
- **CLI Control** — `start`, `stop`, `status`, `logs`, `clean`
- **Real-Time Dashboard** — Next.js frontend with WebSocket updates
- **Multi-Agent** — Hire unlimited agents, each with their own role, model, and memory
- **5-Column Kanban** — Backlog → To Do → Doing → Blocked → Done
- **Streaming Execution Logs** — Watch agents think, type, and execute in real time

### AI & Models
- **8+ AI Providers** — Anthropic, OpenAI, OpenRouter, DeepSeek, Mistral, Google, Ollama, LMStudio
- **80+ Models** — Claude 4, GPT-5, Gemini 2.5, DeepSeek V3, Codestral, and more
- **API Mode + CLI Mode** — Use API keys or local CLI auth (Claude Code, Codex)
- **Tool-Enabled Agents** — Full filesystem and bash access via agent SDKs

### Task Management
- **Flow Tasks** — Multi-step sequential execution across different agents
- **Task Scheduling** — One-shot timestamps and recurring cron expressions
- **Blocked State** — Agents pause and notify you when they need input
- **User Reply** — Reply in chat to unblock a task and resume execution
- **Attachments** — Attach images and files to tasks

### Memory & Context
- **OpenClaw Memory Architecture** — 4 markdown files per agent (SOUL, USER, AGENTS, MEMORY)
- **Auto-Summarization** — MEMORY.md stays under 2000 tokens automatically
- **PROJECT.md Engine** — Auto-generated project context file, updated by agents
- **Tech Stack Detection** — Analyzes your project and pre-fills PROJECT.md

### Integrations
- **Telegram Bot** — Chat with any agent directly from Telegram
- **Slack Bot** — DMs and @mentions in any Slack workspace
- **User Whitelisting** — Restrict platform access to specific user IDs

### Observability
- **The Office** — Visual telemetry UI showing agent status in real time
- **Budget Tracking** — Daily and monthly USD spend limits with auto-kill
- **Token Counters** — Input/output token tracking per task and globally
- **Cost Estimation** — Static pricing table + live OpenRouter pricing API
- **Execution History** — Full structured log stored per task

### UI/UX
- **Dark & Light Mode** — System-aware with manual toggle
- **Collapsible Sidebar** — More screen space when you need it
- **Global Status Bar** — Connection, active agents, tasks, tokens, spend
- **Toast Notifications** — Real-time alerts from agents
- **File Viewer** — Syntax-aware code viewer built into Projects

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   AgentWork Daemon                  │
│                    (Port 1248)                      │
│                                                     │
│  ┌──────────────┐   ┌──────────────────────────┐   │
│  │  Express.js  │   │       Socket.io          │   │
│  │  REST API    │   │   Real-Time Events       │   │
│  └──────────────┘   └──────────────────────────┘   │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │              Service Layer                   │  │
│  │  executor.js │ scheduler.js │ platforms.js   │  │
│  │  ai.js       │ project-doc.js                │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │        SQLite Database (~/.agentwork)        │  │
│  │  projects │ agents │ tasks │ messages        │  │
│  │  settings │ budget_logs                      │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │          Next.js Frontend (SSR)              │  │
│  │  Dashboard │ Kanban │ Projects │ Chat        │  │
│  │  Office    │ Agents │ Settings               │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
        │                          │
        ▼                          ▼
  AI Providers               Platform Bots
  (Anthropic, OpenAI,        (Telegram, Slack)
   OpenRouter, etc.)
```

### Directory Structure

```
agentwork/
├── bin/
│   └── cli.js                    # CLI daemon manager
├── server/
│   ├── index.js                  # Entry point: Express + Socket.io + Next.js
│   ├── db.js                     # SQLite schema & query helpers
│   ├── socket.js                 # WebSocket event handlers
│   ├── routes/
│   │   ├── agents.js             # Agent CRUD + memory file management
│   │   ├── tasks.js              # Task CRUD + execution trigger
│   │   ├── projects.js           # Project CRUD + file tree
│   │   ├── chat.js               # Message history + unread count
│   │   ├── settings.js           # Settings + budget API
│   │   └── files.js              # File reader + folder picker
│   └── services/
│       ├── ai.js                 # Multi-provider AI completion engine
│       ├── executor.js           # Task execution + agent orchestration
│       ├── scheduler.js          # Cron & one-shot task triggers
│       ├── platforms.js          # Telegram & Slack bot integrations
│       └── project-doc.js        # PROJECT.md auto-generation
├── src/
│   ├── app/
│   │   ├── page.js               # Dashboard home
│   │   ├── layout.js             # Root layout + metadata
│   │   ├── providers.js          # Socket, Theme, Status, Unread contexts
│   │   ├── projects/page.js      # Project manager + file explorer
│   │   ├── kanban/page.js        # Kanban board
│   │   ├── agents/page.js        # Agent management (HR)
│   │   ├── chat/page.js          # Agent chat interface
│   │   ├── office/page.js        # Telemetry visualization
│   │   └── settings/page.js      # Configuration
│   ├── components/
│   │   ├── Sidebar.js            # Navigation + collapse + theme toggle
│   │   └── BottomBar.js          # Global status bar
│   └── lib/
│       └── api.js                # Fetch-based API client
├── package.json
├── next.config.mjs
├── tailwind.config.js
└── spec.md                       # Original product specification
```

---

## Tech Stack

| Category | Technology | Purpose |
|----------|-----------|---------|
| **Runtime** | Node.js (ES6+) | Backend daemon |
| **Framework** | Next.js 14.2 | Frontend + SSR |
| **UI Library** | React 18.3 | Component model |
| **Styling** | Tailwind CSS 3.4 | Utility-first CSS |
| **Real-Time** | Socket.io 4.8 | WebSocket events |
| **Database** | better-sqlite3 11.7 | Embedded SQLite |
| **AI (Claude)** | @anthropic-ai/sdk 0.39 | Claude API |
| **AI (Agent)** | @anthropic-ai/claude-agent-sdk 0.2.74 | Claude Code SDK |
| **AI (Codex)** | @openai/codex-sdk 0.114 | OpenAI Codex |
| **AI (OpenAI)** | openai 4.73 | GPT API |
| **Telegram** | telegraf 4.16 | Telegram bot |
| **Slack** | @slack/bolt 4.6 | Slack bot (Socket Mode) |
| **Slack API** | @slack/web-api 7.15 | Slack messages |
| **CLI** | commander 12.1 | Argument parsing |
| **Scheduler** | node-cron 4.2.1 | Cron jobs |
| **UUID** | uuid 10.0 | ID generation |
| **Date Utils** | date-fns 4.1 | Date formatting |
| **Animation** | framer-motion 11.11 | UI animations |
| **Drag & Drop** | @dnd-kit 6.1 | Kanban drag-to-move |
| **Icons** | lucide-react 0.460 | Icon library |
| **Toast** | react-hot-toast 2.4 | Notifications |
| **Console** | chalk 4.1.2 | CLI output colors |

---

## Installation

### Prerequisites

- **Node.js** 18+ (LTS recommended)
- **npm** or **yarn**
- At least one AI provider credential (API key or local CLI auth)

### Clone & Install

```bash
git clone https://github.com/your-org/agentwork.git
cd agentwork
npm install
```

### Build

```bash
npm run build
```

### Link CLI (Optional)

To use the `agentwork` command globally:

```bash
npm link
```

---

## CLI Usage

The `agentwork` CLI manages the background daemon process.

```bash
agentwork <command> [options]
```

### Commands

#### `agentwork start`

Starts the server and Next.js dashboard in the background as a detached daemon.

```bash
agentwork start                    # Start on default port 1248
agentwork start -p 3000            # Start on custom port
agentwork start -f                 # Run in foreground (no daemon)
agentwork start --foreground       # Same as -f
```

The process PID is saved to `~/.agentwork/agentwork.pid`. Logs are written to `~/.agentwork/logs/agentwork.log`.

#### `agentwork stop`

Gracefully shuts down the daemon. Sends `SIGTERM`, waits for clean shutdown, then removes the PID file.

```bash
agentwork stop
```

#### `agentwork status`

Shows whether the daemon is running, its PID, dashboard URL, and the number of active agents.

```bash
agentwork status

# Output example:
# ● AgentWork is running
#   PID:       12345
#   Dashboard: http://localhost:1248
#   Agents:    3 active
```

#### `agentwork logs`

Tails the server log file.

```bash
agentwork logs                     # Show last 50 lines
agentwork logs -n 100              # Show last 100 lines
agentwork logs -f                  # Follow (live tail)
agentwork logs --follow            # Same as -f
```

#### `agentwork clean`

Clears temporary files, caches, and log files from the data directory.

```bash
agentwork clean
```

> If the daemon is running, you will be prompted to stop it first before cleaning.

---

## Dashboard

Open [http://localhost:1248](http://localhost:1248) after starting the server.

### Layout

```
┌──────────┬──────────────────────────────────────────┐
│          │                                          │
│ Sidebar  │           Main Content Area             │
│          │                                          │
│ (220px,  │                                          │
│  collap- │                                          │
│  sible)  │                                          │
│          │                                          │
├──────────┴──────────────────────────────────────────┤
│              Bottom Status Bar                      │
└─────────────────────────────────────────────────────┘
```

**Sidebar navigation:**
- Dashboard
- Projects
- Tasks (Kanban)
- Chat
- Office
- Agents
- Settings

The sidebar collapses to icon-only mode (68px) to maximize workspace. The theme toggle (dark/light) lives at the bottom.

**Bottom bar** shows live:
- WebSocket connection status
- Number of active agents
- Number of running tasks
- Total token usage
- Daily spend in USD

---

### Dashboard Home

The home page gives a quick overview of your entire system:

- **Stats grid** — Total projects, hired agents, completed tasks, monthly spend
- **Task pipeline** — Bar chart showing task distribution across all 5 kanban columns
- **Recent tasks** — Latest task activity with status, agent, and project
- **Quick actions** — Shortcuts to create projects, hire agents, and create tasks

All stats update in real time via WebSocket.

---

### Projects Workspace

The Projects page is a three-pane editor for managing your codebases:

```
┌──────────────┬──────────────────┬──────────────────────┐
│   Projects   │   File Tree      │   File Content       │
│   List       │   (Explorer)     │   (Viewer)           │
└──────────────┴──────────────────┴──────────────────────┘
```

**Features:**
- Create, rename, and delete projects
- Each project maps to an absolute local directory path
- Configure ignore patterns (e.g., `node_modules`, `.git`, `dist`)
- Browse the full file tree for any project
- Click any file to view its contents with syntax highlighting
- Native folder picker dialog for path selection (macOS/Linux)
- `PROJECT.md` is auto-generated when a project is created

**Project data model:**
```
name          - Display name
description   - Short description
path          - Absolute local filesystem path
ignore_patterns - Comma-separated patterns to exclude from tree
```

---

### Kanban Task Engine

The Kanban board is the primary way to assign and dispatch work to agents.

#### Columns

| Column | Description |
|--------|-------------|
| **Backlog** | Ideas and future work |
| **To Do** | Ready to be assigned and started |
| **Doing** | Agent is currently executing |
| **Blocked** | Agent paused, needs user input |
| **Done** | Completed |

#### Task Card

Each task card shows:
- Title and priority badge (low / medium / high)
- Assigned agent avatar and name
- Associated project name
- Task type (single or flow)
- For flow tasks: step count and progress
- Quick action buttons

#### Task Detail Modal

Click any task to open a full editing panel with tabs:

- **Details** — Title, description, agent, project, priority, attachments
- **Execution Logs** — Streaming logs from agent execution (thoughts, commands, output, file changes, errors)
- **Schedule** — Configure one-shot or recurring cron triggers
- **Flow Steps** — For flow tasks: manage sequential steps with per-step agent assignment

#### Moving Tasks

Drag a task card from one column to another, or use the move button in the detail modal. Moving a task to **Doing** automatically triggers agent execution if an agent is assigned.

---

### Agent Chat

The Chat page provides a direct messaging interface to all your agents.

```
┌──────────────┬──────────────────────────────────────┐
│  Agent List  │          Chat Window                 │
│              │                                      │
│  ● Alice     │  You: Can you review the API?        │
│  ○ Bob       │  Alice: Sure, reading the files...   │
│  ● Charlie   │                                      │
│              │  [Message input]                     │
└──────────────┴──────────────────────────────────────┘
```

**Features:**
- Lists all agents with online/offline status indicators
- Full message history per agent
- Real-time message delivery via WebSocket
- Unread message badge on sidebar Chat link
- If an agent is blocked on a task, your reply in chat resumes the execution
- Toast notification when an agent sends a message while you're on another page

---

### The Office

The Office is a live visualization of all your agents' activity.

**Visual elements:**
- Central **Hub Server** node in the middle of the canvas
- One **Agent Desk** node per hired agent, arranged in a grid
- Status icons on each desk:
  - **Zzz** — Sleeping / Idle
  - **Book** — Reading (processing input)
  - **Keyboard** — Coding (writing files)
  - **Gear** — Executing (running commands)
- **Activity beams** — Animated lines flowing between an agent's desk and the hub when the agent is actively working

**Interaction:**
- Click any agent desk to open a detail panel showing:
  - Current status
  - Active and recent tasks
  - Live execution log for the current task

---

### Agents Manager

The Agents page is the HR department — hire, configure, and fire agents.

#### Hiring an Agent

Click **Hire Agent** and fill in:

| Field | Description |
|-------|-------------|
| Name | Display name for the agent |
| Avatar | Emoji avatar |
| Role | Role description (e.g., "Senior React Developer") |
| Auth Type | `api` (API key) or `cli` (local CLI) |
| Provider | AI provider |
| Model | Specific model ID |
| Personality | Free-form system prompt additions |

On creation, a memory directory is created at `~/.agentwork/agents/<agent-id>/` with four initialized markdown files.

#### Agent Memory Tabs

The agent detail panel has four memory file editors:

- **SOUL** — `SOUL.md`: Personality, tone, behavioral rules, output format preferences
- **USER** — `USER.md`: User code style (e.g., "no semicolons", "prefer functional components")
- **AGENTS** — `AGENTS.md`: Operational rules (e.g., "always run tests before marking done")
- **MEMORY** — `MEMORY.md`: Auto-managed long-term memory, manually editable

**Clear Memory** button resets `MEMORY.md` to blank for a fresh context.

#### Platform Chat Setup

On the agent detail panel, configure platform integration:

- Toggle `Enable Platform Chat`
- Choose **Telegram** or **Slack**
- Enter the bot token (and Slack app token for Socket Mode)
- Optionally whitelist specific user IDs

The bot starts automatically when the agent is saved with a valid token.

---

### Settings

#### API Providers

Configure global API keys for all providers:

| Provider | Key Name | Notes |
|----------|----------|-------|
| Anthropic | `anthropic_api_key` | For Claude models |
| OpenAI | `openai_api_key` | For GPT & Codex models |
| OpenRouter | `openrouter_api_key` | 200+ models via one key |
| DeepSeek | `deepseek_api_key` | DeepSeek V3, Reasoner |
| Mistral | `mistral_api_key` | Mistral & Codestral |
| Custom Base URL | `custom_base_url` | Ollama, LMStudio, any OpenAI-compatible |

Keys are stored in the local SQLite database, never sent externally except to the configured provider.

#### Budget

Set spending guardrails:

- **Daily limit** — Maximum USD spend per day (default: $10)
- **Monthly limit** — Maximum USD spend per month (default: $100)
- Live usage progress bars for both limits
- Agents are automatically killed if either limit is exceeded mid-execution

#### Security

- **Require confirmation for destructive commands** — When enabled, agents running `rm`, `drop`, `DELETE`, or other destructive operations will pause and request user approval before proceeding

#### Preferences

- **Theme** — Dark, Light, or System
- **Notification Sounds** — Audio alerts for agent messages and task completions
- **Default Workspace** — Pre-fill the path field when creating new projects

---

## Agents

### Authentication Modes

#### API Mode (`auth_type: 'api'`)

The agent calls the AI provider's REST API using a key stored in Settings. Supports all providers. Requires an internet connection and billing account.

**Supported providers in API mode:**
- Anthropic (Claude)
- OpenAI (GPT)
- OpenRouter (any model)
- DeepSeek
- Mistral
- Google (Gemini)
- Any custom OpenAI-compatible endpoint

#### CLI Mode (`auth_type: 'cli'`)

The agent uses the locally installed `claude` (Claude Code) or `codex` CLI binary, which uses the authentication already configured in those tools. This means:

- No API key needed in AgentWork settings
- Uses your existing Claude Code or OpenAI Codex account
- Free if you have an existing subscription
- Requires the CLI to be installed and authenticated

---

### Supported AI Providers

| Provider | Models | Notes |
|----------|--------|-------|
| **Anthropic** | Claude 4 Opus, Sonnet, Haiku | Best for coding tasks |
| **OpenAI** | GPT-5, GPT-4o, o3, o4-mini | Versatile |
| **OpenRouter** | 200+ models | Single API for everything |
| **DeepSeek** | V3, Reasoner (R1) | Highly capable, cost-efficient |
| **Mistral** | Large, Small, Codestral | European, fast |
| **Google** | Gemini 2.5 Pro/Flash | Large context windows |
| **Ollama** | Any local model | 100% private, no API key |
| **LMStudio** | Any local model | 100% private, no API key |

---

### Supported Models

A non-exhaustive list of models available in the model picker:

**Anthropic:**
- `claude-opus-4-6`
- `claude-sonnet-4-6`
- `claude-haiku-4-5-20251001`
- `claude-opus-4-5`
- `claude-sonnet-4-5`

**OpenAI:**
- `gpt-5`
- `gpt-4.5-preview`
- `gpt-4o`
- `gpt-4o-mini`
- `o3`
- `o4-mini`
- `o1`
- `o1-mini`

**DeepSeek:**
- `deepseek-chat` (V3)
- `deepseek-reasoner` (R1)

**Mistral:**
- `mistral-large-latest`
- `mistral-small-latest`
- `codestral-latest`

**Google:**
- `gemini-2.5-pro-preview`
- `gemini-2.5-flash-preview`
- `gemini-2.0-flash`

**OpenRouter:**
- Any model from openrouter.ai (live pricing via API)

---

### OpenClaw Memory Architecture

Every agent has a dedicated memory directory at:

```
~/.agentwork/agents/<agent-id>/
├── SOUL.md
├── USER.md
├── AGENTS.md
└── MEMORY.md
```

These files are injected into every task execution prompt and every chat message, giving the agent persistent identity and context.

#### `SOUL.md` — Personality & Identity

Defines who the agent is:

```markdown
# Agent Soul

## Personality
You are a pragmatic, detail-oriented senior software engineer...

## Communication Style
- Be concise. No filler.
- Explain your reasoning briefly before taking action.
- Use code blocks for all code.

## Output Format
- Prefer diffs over full file rewrites when possible
- Always include the filename at the top of each code block
```

#### `USER.md` — User Preferences

Describes how the user wants their code written:

```markdown
# User Preferences

## Code Style
- JavaScript only, no TypeScript
- Arrow functions preferred
- No semicolons
- 2-space indentation

## Testing
- Always write tests for new functions
- Use Jest

## Git
- Conventional commits format
- Keep commits focused and small
```

#### `AGENTS.md` — Operational Rules

Hard rules for safe autonomous operation:

```markdown
# Agent Rules

## Safety
- Never delete files without creating a backup first
- Always run `git status` before and after making changes
- If tests fail, fix them before moving task to Done

## Autonomy
- Do not ask for permission for read-only operations
- Ask before making changes to CI/CD configuration
- Always run lint before considering code complete
```

#### `MEMORY.md` — Long-Term Memory

Auto-managed by the agent. After each task, the agent appends key learnings:

```markdown
# Memory

## Project: AgentWork Backend
- Uses better-sqlite3, synchronous API preferred
- Routes live in server/routes/, one file per resource
- Socket.io events defined in server/socket.js

## User Preferences Learned
- User prefers minimal comments
- User wants all API responses in { data, error } format
```

The memory summarization algorithm keeps this file under ~2000 tokens to avoid wasting context. You can reset it via the **Clear Memory** button in the Agents panel.

---

## Task System

### Task Lifecycle

```
Backlog → To Do → Doing → Done
                    ↓
                 Blocked (agent needs help)
                    ↓
              (user replies in chat)
                    ↓
                 Doing (resumes)
```

### Task Data Model

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique identifier |
| `title` | Text | Short task title |
| `description` | Text | Full instructions for the agent |
| `status` | Enum | `backlog`, `todo`, `doing`, `blocked`, `done` |
| `priority` | Enum | `low`, `medium`, `high` |
| `agent_id` | FK | Assigned agent |
| `project_id` | FK | Associated project |
| `task_type` | Enum | `single`, `flow` |
| `flow_items` | JSON | Array of flow steps (flow tasks only) |
| `execution_logs` | JSON | Array of log entries from agent |
| `attachments` | JSON | Array of attached files/images |
| `completion_output` | Text | Final agent output summary |
| `trigger_type` | Enum | `manual`, `schedule`, `cron` |
| `trigger_at` | ISO datetime | When to auto-trigger (schedule) |
| `trigger_cron` | String | Cron expression (cron) |
| `created_at` | Datetime | Creation timestamp |
| `updated_at` | Datetime | Last update |
| `completed_at` | Datetime | Completion timestamp |

---

### Task Types

#### Single Task

The default task type. One agent executes the entire task description from start to finish.

#### Flow Task

A multi-step sequential workflow. Each step is assigned to (potentially a different) agent. Steps execute in order, with each step building on the output of the previous one.

**Use cases:**
- Step 1: Research agent gathers requirements → Step 2: Dev agent implements → Step 3: QA agent writes tests
- Step 1: Backend agent creates API → Step 2: Frontend agent builds UI
- Step 1: Agent reads existing code → Step 2: Agent refactors → Step 3: Agent documents

---

### Flow Tasks

Flow tasks have a `flow_items` array, where each item is:

```json
{
  "id": "uuid",
  "title": "Step title",
  "description": "What this step should accomplish",
  "agent_id": "agent-uuid"
}
```

**Behavior:**
- When a flow task is moved to Doing, step 1 begins
- After step 1 completes, step 2 begins automatically
- Each step's execution is logged separately in the task's execution log
- If any step is blocked, the whole task pauses
- The Kanban card shows step count and current progress

**Creating a flow task:**
1. On the Kanban board, click "Add Task" on any column
2. Select task type **Flow**
3. The first step is auto-created
4. Add additional steps with the **+ Add Step** button
5. Assign different agents to different steps

---

### Task Scheduling

Automate tasks to run at specific times or on a recurring schedule.

#### One-Shot Schedule

Set `trigger_type` to `schedule` and `trigger_at` to an ISO datetime string. The task moves to **Doing** automatically at that time and executes. The trigger is removed after completion.

```
trigger_type: "schedule"
trigger_at:   "2026-04-01T09:00:00.000Z"
```

#### Recurring Cron

Set `trigger_type` to `cron` and `trigger_cron` to a valid cron expression. The task re-executes on the schedule indefinitely.

```
trigger_type: "cron"
trigger_cron: "0 9 * * 1-5"    # Every weekday at 9am
```

**Cron expression format:**
```
┌───────────── minute (0–59)
│ ┌───────────── hour (0–23)
│ │ ┌───────────── day of month (1–31)
│ │ │ ┌───────────── month (1–12)
│ │ │ │ ┌───────────── day of week (0–7, 0 and 7 = Sunday)
│ │ │ │ │
* * * * *
```

**Common examples:**

| Expression | Description |
|------------|-------------|
| `0 9 * * *` | Every day at 9am |
| `0 9 * * 1-5` | Every weekday at 9am |
| `*/30 * * * *` | Every 30 minutes |
| `0 0 * * 0` | Every Sunday at midnight |
| `0 8 1 * *` | 1st of every month at 8am |

---

### The YOLO Execution Loop

When a task moves to **Doing** with an assigned agent, the executor runs the following sequence:

1. **Load context** — Fetch task, agent config, and project details from DB
2. **Read memory** — Load all 4 agent memory files (SOUL, USER, AGENTS, MEMORY)
3. **Read PROJECT.md** — Load the project's documentation file
4. **Build prompt** — Construct the execution prompt combining task description + memory + project context
5. **Choose backend** — Pick Claude Agent SDK, Codex SDK, or direct API call based on agent's `auth_type`
6. **Execute** — Stream events back to Socket.io in real time:
   - `text` — Agent's written thoughts
   - `command` — Shell commands being run
   - `output` — Command output
   - `file_change` — Files created/modified
   - `error` — Errors encountered
7. **Budget check** — After each event, verify spend is within limits
8. **Completion** — Move task to **Done**, save completion output, update budget log
9. **Blocked** — If agent calls `block_task()`, move to **Blocked** and notify user via chat and toast

The agent has full filesystem and bash access through the SDK's built-in tools. It can read files, write files, run commands, and even install packages — all within your project's directory.

---

## Projects

### PROJECT.md Engine

Every project has a `PROJECT.md` file at its root. This file is the agent's primary source of truth for understanding your project.

**Auto-generation:**

When you create a project in AgentWork, `project-doc.js` analyzes the directory and generates a starter `PROJECT.md`:

1. **Tech stack detection** — Scans for `package.json`, `requirements.txt`, `Cargo.toml`, `go.mod`, `Dockerfile`, `docker-compose.yml`, `.github/`, and more
2. **File tree** — Builds a 2-level directory tree excluding common noise directories
3. **Key files** — Lists important files found (config, entry points, manifests)
4. **Template sections** — Placeholders for architecture overview, API docs, data models, and recent decisions

**Agent updates:**

After completing a task, agents can append new information to `PROJECT.md` — new API endpoints they created, data models they added, architectural decisions they made. This keeps the documentation growing automatically over time.

**Detected tech stacks:**

| File / Pattern | Detected Tech |
|----------------|---------------|
| `package.json` | Node.js |
| `next.config.*` | Next.js |
| `vite.config.*` | Vite |
| `src/App.tsx` or `src/App.jsx` | React |
| `nuxt.config.*` | Nuxt.js |
| `requirements.txt` or `pyproject.toml` | Python |
| `Cargo.toml` | Rust |
| `go.mod` | Go |
| `pom.xml` | Java/Maven |
| `Dockerfile` | Docker |
| `docker-compose.yml` | Docker Compose |
| `.github/workflows/` | GitHub Actions |
| `k8s/` or `helm/` | Kubernetes |

---

### File Explorer

The file explorer in the Projects page lets you browse your project without leaving the dashboard.

- Recursive tree view (respects `ignore_patterns`)
- Expand/collapse directories
- Click any file to view contents
- Files under 1MB are displayed inline with syntax-aware rendering
- Useful for reviewing agent-written code immediately after task completion

---

## Platform Integrations

### Telegram

Connect an agent to Telegram so you can chat with it from your phone.

#### Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) on Telegram
2. Copy the bot token
3. In AgentWork → Agents → select agent → Platform Chat tab
4. Enable platform chat, choose Telegram, paste the token
5. Optionally add your Telegram user ID to the allowed list
6. Save — the bot starts immediately

#### Usage

Send any message to your bot in Telegram. The agent receives it, processes it with its full memory context, and replies.

#### Security

If `chat_allowed_ids` is set, only users with those Telegram user IDs can interact with the bot. All others are silently ignored.

#### Response Handling

- Responses over 4096 characters are automatically chunked into multiple messages (Telegram's limit)
- The agent uses the same memory and personality as in the dashboard chat

---

### Slack

Connect an agent to a Slack workspace so your team can interact with it.

#### Setup

1. Create a Slack App at [api.slack.com/apps](https://api.slack.com/apps)
2. Enable **Socket Mode** and generate an **App-Level Token** (xapp-)
3. Subscribe to `message.im` (DMs) and `app_mention` events
4. Install the app to your workspace and copy the **Bot Token** (xoxb-)
5. In AgentWork → Agents → select agent → Platform Chat tab
6. Enable platform chat, choose Slack, paste both tokens
7. Save — the bot connects via Socket Mode

#### Usage

- **Direct Messages** — DM the bot directly
- **Mentions** — @mention the bot in any channel it's invited to

#### Response Handling

- Responses over 4000 characters are chunked (Slack's limit)
- The agent uses its full memory context for every reply

#### Security

If `chat_allowed_ids` is set, only users with those Slack user IDs receive responses.

---

## Budget Management

AgentWork tracks every API call and enforces configurable spending limits.

### How It Works

1. **Cost estimation** — After each API response, the executor calculates cost from input/output token counts
2. **Logging** — Each cost event is written to the `budget_logs` table with agent, provider, model, tokens, and cost
3. **Enforcement** — Before and after each streaming event, the executor checks accumulated spend for the current day and month
4. **Kill switch** — If the daily or monthly limit is exceeded, the current task execution is aborted and the task moves to **Blocked**

### Pricing Data

- **Static table** — Built-in pricing for 100+ models across all providers
- **Live OpenRouter pricing** — If an OpenRouter key is configured, pricing is fetched from their API and cached
- **Estimation** — For models not in the pricing table, cost is estimated based on provider averages

### Budget API

```
GET /api/settings/budget
```

Returns:
```json
{
  "daily": {
    "limit": 10.00,
    "used": 2.43,
    "remaining": 7.57,
    "percentage": 24.3
  },
  "monthly": {
    "limit": 100.00,
    "used": 18.91,
    "remaining": 81.09,
    "percentage": 18.9
  }
}
```

```
GET /api/settings/budget/history?days=30
```

Returns daily cost breakdowns for charting.

---

## Real-Time System

AgentWork uses Socket.io for all live updates between the server and dashboard.

### Events: Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `task:move` | `{ taskId, newStatus }` | Move task to new column |
| `task:execute` | `{ taskId }` | Manually trigger execution |
| `chat:send` | `{ agentId, content }` | Send chat message to agent |
| `chat:user_reply` | `{ taskId, agentId, content }` | Reply to blocked task |
| `agent:status` | `{ agentId, status }` | Manually update agent status |
| `system:get_status` | — | Request current system status |

### Events: Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `system:status` | `{ activeAgents, activeTasks, spend, tokens, connected }` | System health |
| `task:updated` | `{ task }` | Task state changed |
| `task:log` | `{ taskId, entry }` | New execution log entry (streaming) |
| `task:move_error` | `{ message }` | Move validation failed |
| `chat:message` | `{ message }` | New chat message |
| `agent:status_changed` | `{ agentId, status }` | Agent status updated |
| `project:created` | `{ project }` | New project created |
| `project:updated` | `{ project }` | Project modified |
| `project:deleted` | `{ projectId }` | Project deleted |
| `agent:created` | `{ agent }` | New agent hired |
| `agent:updated` | `{ agent }` | Agent updated |
| `agent:deleted` | `{ agentId }` | Agent fired |
| `notification` | `{ message, type }` | Toast notification |
| `budget:update` | `{ daily, monthly }` | Budget usage changed |

---

## Database Schema

The database lives at `~/.agentwork/db/agentwork.db` (SQLite via better-sqlite3, WAL mode).

### `projects`

```sql
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  path        TEXT NOT NULL,          -- Absolute local path
  ignore_patterns TEXT,               -- Comma-separated (e.g., "node_modules,.git")
  created_at  DATETIME DEFAULT (datetime('now')),
  updated_at  DATETIME DEFAULT (datetime('now'))
)
```

### `agents`

```sql
CREATE TABLE agents (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  avatar         TEXT,               -- Emoji
  role           TEXT,               -- e.g., "Senior React Developer"
  auth_type      TEXT DEFAULT 'api', -- 'api' or 'cli'
  provider       TEXT,               -- 'anthropic', 'openai', 'openrouter', etc.
  model          TEXT,               -- Model ID
  status         TEXT DEFAULT 'offline',  -- 'idle', 'offline', 'working', 'thinking', 'executing'
  personality    TEXT,               -- Additional system prompt
  chat_enabled   INTEGER DEFAULT 0,
  chat_platform  TEXT,               -- 'telegram' or 'slack'
  chat_token     TEXT,               -- Bot token
  chat_app_token TEXT,               -- Slack app-level token
  chat_allowed_ids TEXT,             -- Comma-separated user IDs
  created_at     DATETIME DEFAULT (datetime('now')),
  updated_at     DATETIME DEFAULT (datetime('now'))
)
```

### `tasks`

```sql
CREATE TABLE tasks (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  description       TEXT,
  status            TEXT DEFAULT 'backlog',  -- 'backlog','todo','doing','blocked','done'
  priority          TEXT DEFAULT 'medium',   -- 'low','medium','high'
  agent_id          TEXT REFERENCES agents(id),
  project_id        TEXT REFERENCES projects(id),
  execution_logs    TEXT,            -- JSON array of log entries
  attachments       TEXT,            -- JSON array of { name, path, type }
  completion_output TEXT,            -- Final output summary
  trigger_type      TEXT DEFAULT 'manual',   -- 'manual','schedule','cron'
  trigger_at        TEXT,            -- ISO datetime for one-shot
  trigger_cron      TEXT,            -- Cron expression
  task_type         TEXT DEFAULT 'single',   -- 'single' or 'flow'
  flow_items        TEXT,            -- JSON array of flow step objects
  created_at        DATETIME DEFAULT (datetime('now')),
  updated_at        DATETIME DEFAULT (datetime('now')),
  completed_at      DATETIME
)
```

### `messages`

```sql
CREATE TABLE messages (
  id        TEXT PRIMARY KEY,
  agent_id  TEXT NOT NULL REFERENCES agents(id),
  sender    TEXT NOT NULL,    -- 'user' or 'agent'
  content   TEXT NOT NULL,
  task_id   TEXT,             -- Optional: links message to blocked task
  created_at DATETIME DEFAULT (datetime('now'))
)
```

### `settings`

```sql
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT
)
```

Recognized keys:

| Key | Default | Description |
|-----|---------|-------------|
| `anthropic_api_key` | — | Anthropic API key |
| `openai_api_key` | — | OpenAI API key |
| `openrouter_api_key` | — | OpenRouter API key |
| `deepseek_api_key` | — | DeepSeek API key |
| `mistral_api_key` | — | Mistral API key |
| `custom_base_url` | — | Custom OpenAI-compatible base URL |
| `daily_budget_usd` | `10` | Daily spend limit |
| `monthly_budget_usd` | `100` | Monthly spend limit |
| `require_confirmation_destructive` | `false` | Confirm before rm/drop/DELETE |
| `theme` | `dark` | `dark`, `light`, or `system` |
| `notification_sounds` | `true` | Audio notifications |
| `default_workspace` | — | Default project path |

### `budget_logs`

```sql
CREATE TABLE budget_logs (
  id            TEXT PRIMARY KEY,
  agent_id      TEXT,
  provider      TEXT,
  model         TEXT,
  input_tokens  INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_usd      REAL DEFAULT 0,
  created_at    DATETIME DEFAULT (datetime('now'))
)
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Set to `production` for production mode |
| `PORT` | `1248` | HTTP server port |
| `AGENTWORK_ROOT` | Auto-detected | Absolute path to the agentwork source directory |
| `AGENTWORK_DATA` | `~/.agentwork` | User data directory (DB, logs, agent memory) |

---

## Configuration Reference

### Data Directory Layout

```
~/.agentwork/
├── db/
│   └── agentwork.db          # SQLite database
├── agents/
│   ├── <agent-id>/
│   │   ├── SOUL.md
│   │   ├── USER.md
│   │   ├── AGENTS.md
│   │   └── MEMORY.md
│   └── ...
├── logs/
│   └── agentwork.log         # Server logs
└── agentwork.pid             # Daemon PID file
```

### Migration from Previous Installations

If you previously used an `agenthub` installation, AgentWork automatically migrates your data:

- `~/.agenthub/` → `~/.agentwork/` (directory renamed on first run)
- `agenthub.db` → `agentwork.db` (DB file renamed on first run)

---

## Development

### Running in Development Mode

```bash
npm run dev
```

This starts the Express + Next.js server in development mode with hot reload for Next.js pages.

### Building for Production

```bash
npm run build   # Build Next.js
npm start       # Start in production mode
```

### Project Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `node server/index.js` | Development server |
| `build` | `next build` | Build Next.js |
| `start` | `NODE_ENV=production node server/index.js` | Production server |
| `lint` | `next lint` | Run ESLint |

### API Conventions

All REST API responses follow the pattern:

```json
{ "data": ..., "error": null }
// or
{ "data": null, "error": "Error message" }
```

### Adding a New AI Provider

1. Add pricing data in `server/services/ai.js` — `MODEL_PRICING` object
2. Add a `case` in the `createCompletion()` switch statement
3. Add the provider and model to the dropdown in `src/app/agents/page.js`
4. Add the API key input to `src/app/settings/page.js`
5. Add the key name to the settings route handler in `server/routes/settings.js`

### Adding a New Platform Integration

1. Create a handler in `server/services/platforms.js`
2. Register it in the `initializePlatforms()` function
3. Add the platform option to the agent chat setup UI in `src/app/agents/page.js`

---

## License

MIT — see [LICENSE](LICENSE) for details.
