# AgentWork

**AgentWork** is a fully autonomous AI agent orchestration platform that runs locally as a background daemon. It lets you hire, manage, and collaborate with multiple AI agents simultaneously — each with their own memory, personality, role, and long-term context — while you monitor everything through a modern real-time dashboard.

Agents can read and write files, execute bash commands, work through multi-step tasks, chat with you over Telegram, Slack, and Discord, and run on schedules — all while you sleep.

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
  - [Analytics](#analytics)
  - [Pipelines](#pipelines)
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
  - [Task Dependencies](#task-dependencies)
  - [Task Templates](#task-templates)
  - [Task Comments](#task-comments)
  - [Task Scheduling](#task-scheduling)
  - [The YOLO Execution Loop](#the-yolo-execution-loop)
- [Git Automation](#git-automation)
  - [Settings](#git-settings)
  - [Full Workflow](#git-workflow)
- [Projects](#projects)
  - [PROJECT.md Engine](#projectmd-engine)
  - [File Explorer](#file-explorer)
- [Plugin System](#plugin-system)
  - [Plugin Types](#plugin-types)
  - [Directory Structure](#plugin-directory-structure)
  - [Plugin Manifest](#plugin-manifest)
- [Integrations](#integrations)
  - [Telegram](#telegram)
  - [Slack](#slack)
  - [Discord](#discord)
  - [GitHub](#github)
  - [Linear / Jira](#linear--jira)
  - [Email Notifications](#email-notifications)
  - [Webhooks](#webhooks)
  - [MCP Server](#mcp-server)
  - [VS Code Extension](#vs-code-extension)
- [Security](#security)
  - [API Key Encryption](#api-key-encryption)
  - [Command Sandboxing](#command-sandboxing)
  - [Dashboard Authentication](#dashboard-authentication)
  - [Audit Logging](#audit-logging)
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

### AI & Models
- **9 AI Providers** — Anthropic, OpenAI, OpenRouter, DeepSeek, Mistral, Google, Ollama, LMStudio, Custom
- **80+ Models** — Claude 4, GPT-5, Gemini 2.5, DeepSeek V3, Codestral, and more
- **API Mode + CLI Mode** — Use API keys or local CLI auth (Claude Code, Codex)
- **Tool-Enabled Agents** — Full filesystem and bash access via agent SDKs
- **Custom Tools** — Define your own tools with bash command templates

### Memory & Context
- **OpenClaw Memory Architecture** — 4 markdown files per agent (SOUL, USER, AGENTS, MEMORY)
- **Auto-Summarization** — MEMORY.md stays under 2000 tokens automatically
- **PROJECT.md Engine** — Auto-generated project context file, updated by agents
- **Tech Stack Detection** — Analyzes your project and pre-fills PROJECT.md
- **RAG-Based File Retrieval** — Keyword-based TF-IDF file search for relevant project context

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

### Observability
- **The Office** — Visual telemetry UI showing agent status in real time
- **Analytics Dashboard** — Spend charts, agent utilization, model comparison
- **Budget Tracking** — Daily and monthly USD spend limits with auto-kill
- **Token Counters** — Input/output token tracking per task and globally
- **Cost Estimation** — Static pricing table + live OpenRouter pricing API
- **Execution History** — Full structured log stored per task

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
- **Collapsible Sidebar** — More screen space when you need it
- **Global Status Bar** — Connection, active agents, tasks, tokens, spend
- **Toast Notifications** — Real-time alerts from agents

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   AgentWork Daemon                   │
│                    (Port 1248)                       │
│                                                      │
│  ┌──────────────┐   ┌──────────────────────────┐    │
│  │  Express.js  │   │       Socket.io           │    │
│  │  REST API    │   │   Real-Time Events        │    │
│  └──────────────┘   └──────────────────────────┘    │
│                                                      │
│  ┌───────────────────────────────────────────────┐  │
│  │               Service Layer                    │  │
│  │  executor.js │ scheduler.js │ platforms.js     │  │
│  │  ai.js       │ project-doc.js │ rag.js        │  │
│  │  github.js   │ email.js   │ discord.js        │  │
│  │  linear.js   │ plugins.js │ crypto.js         │  │
│  └───────────────────────────────────────────────┘  │
│                                                      │
│  ┌───────────────────────────────────────────────┐  │
│  │        SQLite Database (~/.agentwork)           │  │
│  │  projects │ agents │ tasks │ messages          │  │
│  │  settings │ budget_logs │ pipelines            │  │
│  │  task_templates │ task_comments │ custom_tools │  │
│  │  agent_messages │ chat_rooms │ room_messages   │  │
│  │  agent_sessions │ audit_logs │ schema_migrations│ │
│  └───────────────────────────────────────────────┘  │
│                                                      │
│  ┌───────────────────────────────────────────────┐  │
│  │          Next.js Frontend (SSR)                │  │
│  │  Dashboard │ Kanban │ Projects │ Chat          │  │
│  │  Office    │ Analytics │ Pipelines             │  │
│  │  Agents    │ Settings                          │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
        │                          │
        ▼                          ▼
  AI Providers               Platform Bots
  (Anthropic, OpenAI,        (Telegram, Slack,
   OpenRouter, etc.)          Discord)
        │                          │
        ▼                          ▼
  External Services          MCP Server / VS Code
  (GitHub, Linear,           (Claude Desktop,
   Jira, Email)               VS Code Extension)
```

### Directory Structure

```
agentwork/
├── bin/
│   └── cli.js                    # CLI daemon manager
├── server/
│   ├── index.js                  # Entry point: Express + Socket.io + Next.js
│   ├── db.js                     # SQLite schema, migrations & query helpers
│   ├── socket.js                 # WebSocket event handlers
│   ├── crypto.js                 # AES-256-GCM encryption for API keys
│   ├── plugins.js                # Plugin system loader & registry
│   ├── mcp.js                    # MCP Tool Server (standalone stdio JSON-RPC)
│   ├── routes/
│   │   ├── agents.js             # Agent CRUD + memory file management
│   │   ├── tasks.js              # Task CRUD + execution trigger
│   │   ├── projects.js           # Project CRUD + file tree
│   │   ├── chat.js               # Message history + unread count
│   │   ├── settings.js           # Settings + budget API
│   │   ├── files.js              # File reader + folder picker
│   │   ├── templates.js          # Task template CRUD
│   │   ├── tools.js              # Custom tool CRUD
│   │   ├── rooms.js              # Group chat rooms
│   │   └── pipelines.js          # Pipeline CRUD + execution
│   ├── services/
│   │   ├── ai.js                 # Multi-provider AI completion engine
│   │   ├── executor.js           # Task execution + agent orchestration + git automation
│   │   ├── scheduler.js          # Cron & one-shot task triggers
│   │   ├── platforms.js          # Telegram & Slack bot integrations
│   │   ├── project-doc.js        # PROJECT.md auto-generation
│   │   ├── rag.js                # Keyword-based TF-IDF file retrieval
│   │   ├── github.js             # GitHub issue/PR integration
│   │   ├── email.js              # SMTP notification service
│   │   ├── discord.js            # Discord bot integration
│   │   └── linear.js             # Linear / Jira bidirectional sync
│   └── migrations/
│       └── 001_initial.js        # Migration marker (future migrations go here)
├── src/
│   ├── app/
│   │   ├── page.js               # Dashboard home
│   │   ├── layout.js             # Root layout + metadata
│   │   ├── providers.js          # Socket, Theme, Status, Unread contexts
│   │   ├── globals.css           # Global styles
│   │   ├── projects/page.js      # Project manager + file explorer
│   │   ├── kanban/page.js        # Kanban board + swimlanes
│   │   ├── agents/page.js        # Agent management (HR)
│   │   ├── chat/page.js          # Agent chat interface
│   │   ├── office/page.js        # Telemetry visualization
│   │   ├── analytics/page.js     # Spend charts, agent performance
│   │   ├── pipelines/page.js     # Pipeline management
│   │   └── settings/page.js      # Configuration
│   ├── components/
│   │   ├── Sidebar.js            # Navigation + collapse + theme toggle
│   │   ├── BottomBar.js          # Global status bar
│   │   ├── CodeViewer.js         # Syntax-highlighted code viewer
│   │   ├── DiffViewer.js         # Unified diff viewer
│   │   ├── MarkdownContent.js    # Markdown rendering component
│   │   ├── KeyboardShortcuts.js  # Keyboard shortcut overlay + handler
│   │   ├── OnboardingWizard.js   # 4-step first-run setup wizard
│   │   ├── agents/               # Agent-specific subcomponents
│   │   ├── chat/                 # Chat-specific subcomponents
│   │   ├── kanban/               # Kanban-specific subcomponents
│   │   ├── office/               # Office-specific subcomponents
│   │   ├── projects/             # Project-specific subcomponents
│   │   └── settings/             # Settings-specific subcomponents
│   └── lib/
│       └── api.js                # Fetch-based API client
├── vscode-extension/
│   ├── extension.js              # VS Code extension entry point
│   └── package.json              # Extension manifest (commands, config)
├── public/
│   ├── manifest.json             # PWA manifest
│   ├── sw.js                     # Service worker for offline support
│   ├── icon.svg                  # App icon
│   └── icons/                    # PWA icon set
├── package.json
├── next.config.mjs
├── tailwind.config.js
├── SPEC.md                       # This file — detailed technical spec
└── README.md                     # Project overview
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
- **npm** 9+
- At least one of: API key (Anthropic/OpenAI/OpenRouter) or local CLI auth (Claude Code/Codex)

### Quick Start (Development)

```bash
git clone https://github.com/your-org/agentwork.git
cd agentwork
npm install
npm run build
npm run dev
```

Open [http://localhost:1248](http://localhost:1248) — the onboarding wizard will guide you through initial setup.

### Install as CLI Tool

Link the `agentwork` command globally after cloning:

```bash
git clone https://github.com/your-org/agentwork.git
cd agentwork
npm install
npm run build
npm link
```

Now use it from anywhere:

```bash
agentwork start          # Start the daemon in the background
agentwork status         # Check if it's running
agentwork task list      # List all tasks
agentwork agent list     # List all agents
agentwork stop           # Stop the daemon
```

### Production

```bash
git clone https://github.com/your-org/agentwork.git
cd agentwork
npm run setup            # Install dependencies + build in one command
npm start                # Start in production mode
```

### npm Scripts Reference

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `nodemon server/index.js` | Development with hot reload |
| `dev:no-reload` | `node server/index.js` | Development without hot reload |
| `build` | `next build` | Build Next.js for production (required before first run) |
| `start` | `NODE_ENV=production node server/index.js` | Production server |
| `setup` | `npm install && npm run build` | One-command install + build |
| `lint` | `next lint` | Run ESLint |

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

#### `agentwork task list`

List tasks with optional status filter.

```bash
agentwork task list                # List all tasks
agentwork task list --status doing # List only running tasks
```

#### `agentwork task create`

Create a new task from the command line.

```bash
agentwork task create "Fix the login bug" --description "..." --priority high --agent <id>
```

#### `agentwork agent list`

List all agents with their current status.

```bash
agentwork agent list
```

---

## Dashboard

Open [http://localhost:1248](http://localhost:1248) after starting the server. On first visit, the **Onboarding Wizard** guides you through a 4-step setup: API key configuration, first project creation, first agent hire, and first task creation.

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
- Analytics
- Pipelines
- Agents
- Settings

The sidebar collapses to icon-only mode (68px) to maximize workspace. The theme toggle (dark/light) lives at the bottom.

**Keyboard shortcuts** (press `?` to view):
- `Cmd+K` — Quick command palette
- `Cmd+1` through `Cmd+9` — Navigate to pages
- `?` — Show shortcut help overlay

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
- **Live activity feed** — Real-time event stream showing agent actions as they happen
- **Quick actions** — Shortcuts to create projects, hire agents, and create tasks

All stats update in real time via WebSocket.

---

### Projects Workspace

The Projects page is a three-pane editor for managing your codebases:

```
┌──────────────┬──────────────────┬──────────────────────┐
│   Projects   │   File Tree      │   File Content       │
│   List       │   (Explorer)     │   (Viewer/Editor)    │
└──────────────┴──────────────────┴──────────────────────┘
```

**Features:**
- Create, rename, and delete projects
- Each project maps to an absolute local directory path
- Configure ignore patterns (e.g., `node_modules`, `.git`, `dist`)
- Browse the full file tree for any project
- Click any file to view its contents with **syntax highlighting** (CodeViewer component — JS/TS/Python/JSON/CSS/Markdown and more)
- **In-line file editor** — Edit and save files directly from the dashboard
- **Diff viewer** — View unified diffs with color-coded added/removed lines
- Native folder picker dialog for path selection (macOS/Linux)
- `PROJECT.md` is auto-generated when a project is created
- **File search** — Search across the file tree
- **Git status** — View git status and diffs for the project
- **Project health score** — Computed from file coverage, test presence, and documentation

**Project data model:**
```
name              - Display name
description       - Short description
path              - Absolute local filesystem path
ignore_patterns   - Comma-separated patterns to exclude from tree
default_agent_id  - Default agent to assign to new tasks
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

#### Swimlanes

The Kanban view supports three swimlane grouping modes:
- **By Agent** — Group tasks by assigned agent
- **By Project** — Group tasks by project
- **By Priority** — Group tasks by priority level (high, medium, low)

Toggle between swimlane modes via the toolbar above the board.

#### Task Card

Each task card shows:
- Title and priority badge (low / medium / high)
- Assigned agent avatar and name
- Associated project name
- Task type (single or flow)
- For flow tasks: step count and progress
- Tags/labels
- Quick action buttons
- Dependency indicator if task depends on others

#### Task Detail Modal

Click any task to open a full editing panel with tabs:

- **Details** — Title, description, agent, project, priority, tags, attachments, dependencies, parent task
- **Execution Logs** — Streaming logs from agent execution (thoughts, commands, output, file changes, errors) with type filtering and text search
- **Comments** — Discussion threads separate from execution logs
- **Schedule** — Configure one-shot or recurring cron triggers
- **Flow Steps** — For flow tasks: manage sequential steps with per-step agent assignment

#### Bulk Operations

Select multiple tasks and apply bulk actions:
- Change status
- Assign to agent
- Delete

#### Moving Tasks

Drag a task card from one column to another, or use the move button in the detail modal. Moving a task to **Doing** automatically triggers agent execution if an agent is assigned. Dependency checks are enforced — a task with unmet dependencies cannot be moved to Doing.

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
- **Streaming responses** — Token-by-token streaming with live display
- **Markdown rendering** — Rich formatting, code blocks with syntax highlighting
- **Chat search** — Search message history
- **Chat export** — Export conversation as text
- Unread message badge on sidebar Chat link
- If an agent is blocked on a task, your reply in chat resumes the execution
- Toast notification when an agent sends a message while you're on another page

#### Group Chat Rooms

Create group chat rooms with multiple agents for collaborative discussions:
- Agents respond in turn based on the conversation context
- Messages stream in real time
- Each agent uses its own memory and personality

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
- **Execution timeline / Gantt chart** — Visual timeline of task execution

**Interaction:**
- Click any agent desk to open a detail panel showing:
  - Current status
  - Active and recent tasks
  - Live execution log for the current task

---

### Analytics

The Analytics page (`/analytics`) provides data visualization and performance metrics:

- **Spend charts** — Daily and monthly cost breakdowns by agent and model
- **Agent utilization** — Time spent working vs idle per agent
- **Model comparison** — Cost-per-task and success rate across different models
- **Task throughput** — Completed tasks over time
- **Budget health** — Progress toward daily/monthly limits with trend lines

---

### Pipelines

The Pipelines page (`/pipelines`) lets you define and manage reusable multi-step workflows:

- **Pipeline CRUD** — Create, edit, and delete pipelines
- Each pipeline consists of an ordered list of steps
- Steps reference agents, task descriptions, and dependencies
- **Run pipelines** — Execute a pipeline which creates and runs tasks for each step
- Pipelines are stored in the `pipelines` database table

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
| Fallback Model | Secondary model on API failure |
| Personality | Free-form system prompt additions |
| Allowed Tools | Whitelist of tools this agent can use |
| Daily Budget | Per-agent daily spend cap (USD) |

On creation, a memory directory is created at `~/.agentwork/agents/<agent-id>/` with four initialized markdown files.

#### Agent Cloning

Click the **Clone** button on any agent to duplicate its configuration and memory files. The clone gets a new ID but inherits the source agent's personality, role, model, and all memory files.

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
- Choose **Telegram**, **Slack**, or **Discord**
- Enter the bot token (and Slack app token for Socket Mode)
- Optionally whitelist specific user IDs
- Save — the bot starts automatically when the agent is saved with a valid token

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
| Google | `google_api_key` | Gemini 2.5 Pro/Flash |
| Custom Base URL | `custom_base_url` | Ollama, LMStudio, any OpenAI-compatible |

Keys are encrypted with AES-256-GCM before being stored in SQLite. They are never sent externally except to the configured provider.

#### Budget

Set spending guardrails:

- **Daily limit** — Maximum USD spend per day (default: $10)
- **Monthly limit** — Maximum USD spend per month (default: $100)
- Live usage progress bars for both limits
- Agents are automatically killed if either limit is exceeded mid-execution

#### Git Automation

Control git behavior with four toggles:

| Setting | Default | Description |
|---------|---------|-------------|
| `auto_git_branch` | `true` | Create feature branches for tasks |
| `auto_git_sync` | `true` | Pull latest from main before starting |
| `auto_git_merge` | `true` | Squash-merge PR or local merge after completion |
| `auto_git_init` | `true` | Auto-initialize git for non-repo projects |

#### Email Notifications

Configure SMTP for email alerts:

| Setting | Description |
|---------|-------------|
| `smtp_host` | SMTP server hostname |
| `smtp_port` | SMTP port (default: 587) |
| `smtp_user` | SMTP username |
| `smtp_pass` | SMTP password (encrypted) |
| `smtp_from` | Sender email address |
| `notification_email` | Recipient email address |

#### Notification Preferences

| Setting | Default | Description |
|---------|---------|-------------|
| `notify_task_complete` | `true` | Notify when tasks finish |
| `notify_task_blocked` | `true` | Notify when tasks block |
| `notify_budget_threshold` | `true` | Notify when approaching budget limit |
| `notify_agent_messages` | `true` | Notify on agent chat messages |
| `notification_sounds` | `true` | Audio notifications |

#### Security

- **Dashboard Password** — Optional `dashboard_password` setting to protect the UI
- **Require confirmation for destructive commands** — When enabled, agents running `rm`, `drop`, `DELETE`, or other destructive operations will pause and request user approval

#### Execution

| Setting | Default | Description |
|---------|---------|-------------|
| `max_iterations` | `30` | Maximum agent iterations per task |
| `task_timeout_minutes` | `0` | Task timeout (0 = no limit) |
| `rate_limit_ms` | `0` | Minimum ms between API calls |
| `max_concurrent_executions` | `3` | Maximum parallel task executions |

#### Preferences

- **Theme** — Dark, Light, or System
- **Accent Color** — 6 presets (blue, green, purple, orange, red, pink)
- **Default Workspace** — Pre-fill the path field when creating new projects
- **Verbose AI Logging** — Log full API payloads for debugging

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

#### `TEAM.md` — Shared Memory

A shared memory file at `~/.agentwork/TEAM.md` is readable by all agents. Use this for cross-agent coordination, shared conventions, and team-wide rules.

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
| `flow_items` | JSON | Array of flow step objects |
| `execution_logs` | JSON | Array of log entries from agent |
| `attachments` | JSON | Array of attached files/images |
| `completion_output` | Text | Final agent output summary |
| `trigger_type` | Enum | `manual`, `schedule`, `cron` |
| `trigger_at` | ISO datetime | When to auto-trigger (schedule) |
| `trigger_cron` | String | Cron expression (cron) |
| `tags` | Text | Comma-separated tags for filtering |
| `depends_on` | JSON | Array of task IDs this task depends on |
| `parent_id` | FK | Parent task ID (sub-tasks) |
| `estimated_minutes` | Integer | Time estimate for SLA tracking |
| `started_at` | Datetime | When execution began |
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

### Task Dependencies

Tasks can depend on other tasks via the `depends_on` field (JSON array of task IDs). When a task with unmet dependencies is moved to **Doing**, the system blocks the move and displays the names of the unmet dependency tasks. Dependencies form a DAG (Directed Acyclic Graph) — when a dependency completes, the next queued task with the highest priority auto-starts.

---

### Task Templates

Save task blueprints as reusable templates via the `/api/templates` endpoint.

**Template data model:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Template identifier |
| `name` | Text | Template name |
| `description` | Text | Default task description |
| `priority` | Enum | Default priority |
| `agent_id` | FK | Default agent |
| `project_id` | FK | Default project |
| `task_type` | Enum | `single` or `flow` |
| `flow_items` | JSON | Default flow steps |
| `tags` | Text | Default tags |

Templates can be created from scratch or from an existing task (via `from_task_id`).

---

### Task Comments

Each task has a separate comments thread (`task_comments` table), distinct from execution logs. Comments are for human discussion about the task and are not visible to the agent during execution.

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
2. **Read memory** — Load all 4 agent memory files (SOUL, USER, AGENTS, MEMORY) + TEAM.md
3. **Read PROJECT.md** — Load the project's documentation file
4. **RAG retrieval** — Search project files for context relevant to the task description
5. **Build prompt** — Construct the execution prompt combining task description + memory + project context + RAG results
6. **Git setup** — If git automation enabled: auto-init → sync from main → create feature branch
7. **Choose backend** — Pick Claude Agent SDK, Codex SDK, or direct API call based on agent's `auth_type`
8. **Execute** — Stream events back to Socket.io in real time:
   - `text` — Agent's written thoughts
   - `command` — Shell commands being run
   - `output` — Command output
   - `file_change` — Files created/modified
   - `error` — Errors encountered
9. **Budget check** — After each event, verify spend is within limits (global + per-agent)
10. **Completion** — Git commit + push + PR + merge → Move task to **Done** → Save completion output → Update budget log → Send notifications (email, platforms)
11. **Blocked** — If agent calls `block_task()`, move to **Blocked** and notify user via chat, toast, and optionally create a GitHub issue
12. **Next task** — Auto-start the next highest-priority queued task for the same agent

The agent has full filesystem and bash access through the SDK's built-in tools, plus any **custom tools** defined in the `custom_tools` table. It can read files, write files, run commands, and even install packages — all within your project's directory.

---

## Git Automation

Git automation is enabled by default and manages the full branching workflow for each task.

### Git Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `auto_git_init` | `true` | Initializes a git repo if the project directory doesn't have one |
| `auto_git_sync` | `true` | Pulls latest from main/master before creating a task branch |
| `auto_git_branch` | `true` | Creates `agentwork/<task-slug>-<id>` branches for tasks |
| `auto_git_merge` | `true` | Squash-merges to main via PR (or local merge as fallback) |

### Git Workflow

The full git lifecycle for a task execution:

```
1. auto_git_init
   └── If project directory has no .git → run `git init` + initial commit

2. auto_git_sync
   ├── Stash uncommitted changes
   ├── Checkout main/master
   ├── Pull latest (--ff-only, fallback to --rebase)
   ├── Restore stash (auto-resolve conflicts: accept incoming)
   └── Log sync status

3. auto_git_branch
   └── Create branch: `agentwork/<slugified-title>-<task-id-prefix>`

4. [Agent executes task...]

5. auto_git_branch (post-execution)
   ├── Stage all changes: `git add -A`
   ├── Commit: `feat: <task-title>\n\nCompleted by AgentWork task <id>`
   ├── Push: `git push -u origin <branch>`
   ├── Create PR via `gh pr create` (if gh CLI available)
   └── If auto_git_merge:
       ├── Try: `gh pr merge --squash --delete-branch`
       └── Fallback: local `git merge` + `git branch -d`

6. Return to main branch
```

If any git step fails, the executor logs a warning and continues. Git failures never block task execution.

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
- **Syntax-highlighted code viewer** (CodeViewer component) supporting JS, TS, Python, JSON, CSS, Markdown, and more
- **In-line file editor** — Edit and save files directly from the browser
- **Diff viewer** — See unified diffs with color-coded added/removed lines
- Files under 1MB are displayed inline
- Useful for reviewing agent-written code immediately after task completion

---

## Plugin System

The plugin system allows third-party extensions to add tools, hooks, and platform integrations.

### Plugin Types

| Type | Description | Export Format |
|------|-------------|---------------|
| `tool` | Custom tool available during agent execution | `{ name, description, parameters, handler(input, workDir) }` |
| `hook` | Event-driven handler triggered by system events | `{ event, handler(data) }` |
| `platform` | Additional chat platform integration | Platform-specific |

### Plugin Directory Structure

Plugins live in `~/.agentwork/plugins/`. Each plugin is a directory containing:

```
~/.agentwork/plugins/
└── my-plugin/
    ├── plugin.json     # Manifest (required)
    └── index.js        # Entry point (required)
```

### Plugin Manifest

The `plugin.json` file defines the plugin's metadata:

```json
{
  "name": "my-custom-tool",
  "version": "1.0.0",
  "description": "A custom tool that does something useful",
  "type": "tool"
}
```

Required fields: `name`, `version`, `type`.

Valid types: `tool`, `platform`, `hook`.

**Tool plugin example (`index.js`):**

```js
module.exports = {
  name: 'search_jira',
  description: 'Search Jira issues by query',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'JQL query' }
    },
    required: ['query']
  },
  async handler(input, workDir) {
    // Execute and return result
    return { issues: [...] };
  }
};
```

**Hook plugin example (`index.js`):**

```js
module.exports = {
  event: 'task:completed',
  async handler(data) {
    // data = { task, agent, project }
    console.log(`Task ${data.task.title} completed!`);
  }
};
```

Plugins are loaded on server startup. Invalid plugins (missing manifest, bad JSON, unknown type) are skipped with a console warning.

---

## Integrations

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

### Discord

Connect an agent to a Discord server.

#### Setup

1. Create a Discord Application at [discord.com/developers](https://discord.com/developers/applications)
2. Create a Bot and copy the bot token
3. Enable the **Message Content** privileged intent
4. Install `discord.js`: `npm install discord.js`
5. In AgentWork → Agents → select agent → Platform Chat tab
6. Enable platform chat, choose Discord, paste the bot token
7. Optionally whitelist specific Discord user IDs
8. Save — the bot connects automatically

#### Usage

- DM the bot directly
- Send messages in channels the bot can read

#### Security

If `chat_allowed_ids` is set, only users with those Discord user IDs receive responses. Bot messages are ignored.

---

### GitHub

Integrates with GitHub to automatically create issues and pull requests.

#### Configuration

Set these in AgentWork settings:
- `github_token` — Personal access token with `repo` scope
- `github_repo` — Repository in `owner/repo` format

#### Features

- **Auto-create issues from blocked tasks** — When a task moves to Blocked, a GitHub issue is created with the `agentwork` and `blocked` labels
- **Auto-create PRs from completed tasks** — The git automation flow pushes a branch and creates a PR via the GitHub REST API
- **Close issues on completion** — When a task linked to an issue completes, the issue is closed

---

### Linear / Jira

Bidirectional task sync with Linear and Jira project management tools.

#### Linear Configuration

| Setting | Description |
|---------|-------------|
| `linear_api_key` | Linear API key |
| `linear_team_id` | Linear team ID |

When a task is created in AgentWork, it can be synced to Linear as an issue via the GraphQL API.

#### Jira Configuration

| Setting | Description |
|---------|-------------|
| `jira_url` | Jira instance URL (e.g., `https://your-org.atlassian.net`) |
| `jira_email` | Jira account email |
| `jira_api_token` | Jira API token |
| `jira_project_key` | Jira project key (e.g., `PROJ`) |

Tasks sync as Jira issues via the REST API.

---

### Email Notifications

SMTP-based email alerts for key events.

#### Configuration

Configure via settings: `smtp_host`, `smtp_port` (default 587), `smtp_user`, `smtp_pass`, `smtp_from`, `notification_email`.

#### Events

Emails are sent for:
- Task completion (`notify_task_complete`)
- Task blocked (`notify_task_blocked`)
- Budget threshold reached (`notify_budget_threshold`)
- Agent messages (`notify_agent_messages`)

Each notification preference can be toggled independently.

---

### Webhooks

External systems can trigger task creation via HTTP:

```
POST /api/webhooks/trigger
Content-Type: application/json

{
  "title": "Deploy to staging",
  "description": "Run the staging deployment pipeline",
  "agent_id": "optional-agent-id",
  "project_id": "optional-project-id"
}
```

Use this for CI/CD pipelines, monitoring alerts, or any external automation.

---

### MCP Server

AgentWork includes a standalone MCP (Model Context Protocol) server that exposes tasks, agents, and projects to compatible clients like Claude Desktop.

#### Setup

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agentwork": {
      "command": "node",
      "args": ["/path/to/agentwork/server/mcp.js"]
    }
  }
}
```

#### Available Tools

| MCP Tool | Description |
|----------|-------------|
| `agentwork_list_tasks` | List all tasks (optional status filter) |
| `agentwork_create_task` | Create a new task |
| `agentwork_list_agents` | List all agents |
| `agentwork_list_projects` | List all projects |
| `agentwork_get_status` | Get system status (agents, tasks, spend) |

The MCP server communicates with the running AgentWork instance via its REST API (`http://localhost:1248` by default, configurable via `AGENTWORK_URL` env var).

---

### VS Code Extension

A companion VS Code extension for interacting with AgentWork from your editor.

#### Location

```
vscode-extension/
├── extension.js     # Extension entry point
└── package.json     # Extension manifest
```

#### Commands

| Command | Description |
|---------|-------------|
| `AgentWork: Show Status` | Display active agents, running tasks, and daily spend |
| `AgentWork: Create Task` | Create a new task with a title input |
| `AgentWork: List Agents` | Show all agents in a quick-pick list |

#### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `agentwork.serverUrl` | `http://localhost:1248` | AgentWork server URL |

Install by copying the `vscode-extension/` directory to your VS Code extensions folder or using `code --install-extension`.

---

## Security

### API Key Encryption

All sensitive settings (API keys, passwords, SMTP credentials) are encrypted at rest using **AES-256-GCM**.

**How it works:**
1. A 256-bit encryption key is derived from machine-specific data: hostname, data directory path, and OS username
2. Each value is encrypted with a random 12-byte IV
3. Encrypted values are stored with the prefix `enc:` followed by `<iv>:<auth-tag>:<ciphertext>` (all hex-encoded)
4. Decryption is transparent — the system auto-decrypts when reading settings
5. If decryption fails (e.g., migrated data from another machine), the raw value is returned

**Encrypted keys:** `anthropic_api_key`, `openai_api_key`, `openrouter_api_key`, `deepseek_api_key`, `mistral_api_key`, `google_api_key`, `dashboard_password`, `smtp_pass`

### Command Sandboxing

When `require_confirmation_destructive` is enabled, the executor intercepts dangerous commands (`rm`, `drop`, `DELETE`, etc.) and pauses execution. The task moves to **Blocked** and the user must approve the command before it runs.

All file API operations are restricted to project directories — path traversal attempts are blocked.

### Dashboard Authentication

Set a `dashboard_password` in settings to require authentication when accessing the dashboard. The password is encrypted at rest.

### Audit Logging

All CRUD operations are logged to the `audit_logs` table with:
- Action type (create, update, delete)
- Resource type (task, agent, project, etc.)
- Resource ID
- Details/metadata
- Timestamp

Query audit logs via `GET /api/settings/audit-logs`.

---

## Budget Management

AgentWork tracks every API call and enforces configurable spending limits.

### How It Works

1. **Cost estimation** — After each API response, the executor calculates cost from input/output token counts
2. **Logging** — Each cost event is written to the `budget_logs` table with agent, provider, model, tokens, and cost
3. **Enforcement** — Before and after each streaming event, the executor checks accumulated spend for the current day and month
4. **Kill switch** — If the daily or monthly limit is exceeded, the current task execution is aborted and the task moves to **Blocked**
5. **Per-agent limits** — Each agent has an optional `daily_budget_usd` field for individual spend caps

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
| `task:comment` | `{ taskId, comment }` | New task comment added |
| `chat:message` | `{ message }` | New chat message |
| `chat:stream` | `{ agentId, token }` | Streaming token from agent response |
| `chat:stream_end` | `{ agentId, messageId }` | Streaming response complete |
| `room:message` | `{ roomId, message }` | New group chat room message |
| `room:stream` | `{ roomId, agentId, token }` | Streaming token in group chat |
| `agent:status_changed` | `{ agentId, status }` | Agent status updated |
| `agent:message` | `{ fromAgentId, toAgentId, content }` | Agent-to-agent message |
| `project:created` | `{ project }` | New project created |
| `project:updated` | `{ project }` | Project modified |
| `project:deleted` | `{ projectId }` | Project deleted |
| `agent:created` | `{ agent }` | New agent hired |
| `agent:updated` | `{ agent }` | Agent updated |
| `agent:deleted` | `{ agentId }` | Agent fired |
| `tools:updated` | — | Custom tools list changed |
| `notification` | `{ message, type }` | Toast notification |
| `budget:update` | `{ daily, monthly }` | Budget usage changed |

---

## Database Schema

The database lives at `~/.agentwork/db/agentwork.db` (SQLite via better-sqlite3, WAL mode, foreign keys enabled).

### `projects`

```sql
CREATE TABLE projects (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  description       TEXT DEFAULT '',
  path              TEXT NOT NULL,
  ignore_patterns   TEXT DEFAULT 'node_modules,.git,dist,build,.next',
  default_agent_id  TEXT DEFAULT NULL,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### `agents`

```sql
CREATE TABLE agents (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  avatar           TEXT DEFAULT '🤖',
  role             TEXT DEFAULT 'General Developer',
  auth_type        TEXT DEFAULT 'api',
  provider         TEXT DEFAULT 'anthropic',
  model            TEXT DEFAULT 'claude-sonnet-4-20250514',
  status           TEXT DEFAULT 'idle',
  personality      TEXT DEFAULT '',
  chat_enabled     INTEGER DEFAULT 0,
  chat_platform    TEXT DEFAULT '',
  chat_token       TEXT DEFAULT '',
  chat_app_token   TEXT DEFAULT '',
  chat_allowed_ids TEXT DEFAULT '',
  daily_budget_usd REAL DEFAULT 0,
  fallback_model   TEXT DEFAULT '',
  allowed_tools    TEXT DEFAULT '',
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### `tasks`

```sql
CREATE TABLE tasks (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  description       TEXT DEFAULT '',
  status            TEXT DEFAULT 'backlog',
  priority          TEXT DEFAULT 'medium',
  agent_id          TEXT REFERENCES agents(id) ON DELETE SET NULL,
  project_id        TEXT REFERENCES projects(id) ON DELETE SET NULL,
  execution_logs    TEXT DEFAULT '[]',
  attachments       TEXT DEFAULT '[]',
  completion_output TEXT DEFAULT '',
  trigger_type      TEXT DEFAULT 'manual',
  trigger_at        TEXT DEFAULT NULL,
  trigger_cron      TEXT DEFAULT '',
  task_type         TEXT DEFAULT 'single',
  flow_items        TEXT DEFAULT '[]',
  tags              TEXT DEFAULT '',
  depends_on        TEXT DEFAULT '[]',
  parent_id         TEXT DEFAULT NULL,
  estimated_minutes INTEGER DEFAULT 0,
  started_at        DATETIME DEFAULT NULL,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at      DATETIME
)
```

### `messages`

```sql
CREATE TABLE messages (
  id         TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  sender     TEXT NOT NULL,
  content    TEXT NOT NULL,
  task_id    TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### `settings`

```sql
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
)
```

Recognized keys:

| Key | Default | Description |
|-----|---------|-------------|
| `anthropic_api_key` | — | Anthropic API key (encrypted) |
| `openai_api_key` | — | OpenAI API key (encrypted) |
| `openrouter_api_key` | — | OpenRouter API key (encrypted) |
| `deepseek_api_key` | — | DeepSeek API key (encrypted) |
| `mistral_api_key` | — | Mistral API key (encrypted) |
| `google_api_key` | — | Google API key (encrypted) |
| `custom_base_url` | — | Custom OpenAI-compatible base URL |
| `daily_budget_usd` | `10` | Daily spend limit |
| `monthly_budget_usd` | `100` | Monthly spend limit |
| `require_confirmation_destructive` | `true` | Confirm before rm/drop/DELETE |
| `theme` | `system` | `dark`, `light`, or `system` |
| `accent_color` | `blue` | UI accent color preset |
| `notification_sounds` | `true` | Audio notifications |
| `default_workspace` | — | Default project path |
| `max_iterations` | `30` | Max agent iterations per task |
| `task_timeout_minutes` | `0` | Task timeout (0 = none) |
| `rate_limit_ms` | `0` | Min ms between API calls |
| `max_concurrent_executions` | `3` | Max parallel executions |
| `dashboard_password` | — | Dashboard auth password (encrypted) |
| `auto_git_branch` | `true` | Create feature branches |
| `auto_git_sync` | `true` | Sync from main before tasks |
| `auto_git_merge` | `true` | Auto-merge after completion |
| `auto_git_init` | `true` | Auto-init git repos |
| `verbose_ai_logging` | `false` | Log full API payloads |
| `smtp_host` | — | SMTP server hostname |
| `smtp_port` | `587` | SMTP port |
| `smtp_user` | — | SMTP username |
| `smtp_pass` | — | SMTP password (encrypted) |
| `smtp_from` | — | Sender email address |
| `notification_email` | — | Recipient email |
| `notify_task_complete` | `true` | Email on task completion |
| `notify_task_blocked` | `true` | Email on task blocked |
| `notify_budget_threshold` | `true` | Email on budget warning |
| `notify_agent_messages` | `true` | Email on agent messages |
| `onboarding_complete` | `false` | Whether onboarding wizard was completed |

### `budget_logs`

```sql
CREATE TABLE budget_logs (
  id            TEXT PRIMARY KEY,
  agent_id      TEXT REFERENCES agents(id) ON DELETE SET NULL,
  provider      TEXT,
  model         TEXT,
  input_tokens  INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_usd      REAL DEFAULT 0,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### `task_templates`

```sql
CREATE TABLE task_templates (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  priority    TEXT DEFAULT 'medium',
  agent_id    TEXT,
  project_id  TEXT,
  task_type   TEXT DEFAULT 'single',
  flow_items  TEXT DEFAULT '[]',
  tags        TEXT DEFAULT '',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### `task_comments`

```sql
CREATE TABLE task_comments (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### `custom_tools`

```sql
CREATE TABLE custom_tools (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL UNIQUE,
  description      TEXT NOT NULL,
  command_template  TEXT NOT NULL,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### `agent_messages`

```sql
CREATE TABLE agent_messages (
  id            TEXT PRIMARY KEY,
  from_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  to_agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  content       TEXT NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### `chat_rooms`

```sql
CREATE TABLE chat_rooms (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  agent_ids  TEXT DEFAULT '[]',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### `room_messages`

```sql
CREATE TABLE room_messages (
  id          TEXT PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL,
  sender_id   TEXT,
  sender_name TEXT,
  content     TEXT NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### `pipelines`

```sql
CREATE TABLE pipelines (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  steps      TEXT DEFAULT '[]',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### `agent_sessions`

```sql
CREATE TABLE agent_sessions (
  agent_id   TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  session_id TEXT,
  provider   TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### `audit_logs`

```sql
CREATE TABLE audit_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  action        TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id   TEXT,
  details       TEXT DEFAULT '',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### `schema_migrations`

```sql
CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

Migrations are stored as numbered JavaScript files in `server/migrations/` (e.g., `001_initial.js`, `002_add_feature.js`). Each migration exports an `up(db)` function. Applied migrations are tracked in this table to prevent re-execution.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Set to `production` for production mode |
| `PORT` | `1248` | HTTP server port |
| `AGENTWORK_ROOT` | Auto-detected | Absolute path to the agentwork source directory |
| `AGENTWORK_DATA` | `~/.agentwork` | User data directory (DB, logs, agent memory) |
| `AGENTWORK_URL` | `http://localhost:1248` | Server URL (used by MCP server) |
| `AGENTWORK_SETTING_*` | — | Override any setting (e.g., `AGENTWORK_SETTING_ANTHROPIC_API_KEY`) |

---

## Configuration Reference

### Data Directory Layout

```
~/.agentwork/
├── db/
│   └── agentwork.db          # SQLite database (encrypted API keys)
├── agents/
│   ├── <agent-id>/
│   │   ├── SOUL.md
│   │   ├── USER.md
│   │   ├── AGENTS.md
│   │   └── MEMORY.md
│   └── ...
├── TEAM.md                   # Shared memory across all agents
├── plugins/                  # Third-party plugins
│   └── <plugin-name>/
│       ├── plugin.json
│       └── index.js
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
| `dev:no-reload` | `node server/index.js` (no nodemon) | Dev without hot reload |
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

### API Endpoints

`GET /api/docs` returns a JSON listing of all 50+ API endpoints.

Key route files:

| Route File | Base Path | Description |
|------------|-----------|-------------|
| `routes/tasks.js` | `/api/tasks` | Task CRUD, bulk operations, subtasks, replay |
| `routes/agents.js` | `/api/agents` | Agent CRUD, clone, metrics, prompt analysis, inbox |
| `routes/projects.js` | `/api/projects` | Project CRUD, file search, git status, diff, health score |
| `routes/chat.js` | `/api/chat` | Message history, unread count |
| `routes/settings.js` | `/api/settings` | Settings, budget, cost breakdown, reports, export, audit logs |
| `routes/templates.js` | `/api/templates` | Task template CRUD |
| `routes/tools.js` | `/api/tools` | Custom tool CRUD |
| `routes/rooms.js` | `/api/rooms` | Group chat room CRUD + messages |
| `routes/pipelines.js` | `/api/pipelines` | Pipeline CRUD + execution |
| `routes/files.js` | `/api/files` | File reader + folder picker |

Additional endpoints:
- `/api/webhooks/trigger` — External task trigger (POST)
- `/api/health` — System health check (GET)
- `/api/status` — System status (GET)

### Adding a New AI Provider

1. Add pricing data in `server/services/ai.js` — `MODEL_PRICING` object
2. Add a `case` in the `createCompletion()` switch statement
3. Add the provider and model to the dropdown in `src/app/agents/page.js`
4. Add the API key input to `src/app/settings/page.js`
5. Add the key name to the settings route handler in `server/routes/settings.js`

### Adding a New Platform Integration

1. Create a handler in `server/services/platforms.js` (or a dedicated service file like `discord.js`)
2. Register it in the `initializePlatforms()` function
3. Add the platform option to the agent chat setup UI in `src/app/agents/page.js`

### Adding a New Plugin

1. Create a directory under `~/.agentwork/plugins/`
2. Add a `plugin.json` manifest with `name`, `version`, and `type`
3. Add an `index.js` entry point exporting the required interface
4. Restart the server to load the plugin

---

## License

MIT — see [LICENSE](LICENSE) for details.
