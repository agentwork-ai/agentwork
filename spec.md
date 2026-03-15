**System Role & Objective:**
You are an Expert Full-Stack Developer and AI Architect. Your goal is to build **AgentHub**, a comprehensive, background-running orchestrator system that allows users to hire, manage, and collaborate with autonomous AI agents.

### 🛑 CRITICAL CONSTRAINTS

1. **Language:** Strict Node.js and plain JavaScript (ES6+). **Absolutely NO TypeScript.** 2. **Frameworks:** Node.js (Backend daemon/CLI), Next.js (Frontend Dashboard).
2. **Port:** Dashboard must run reliably on `http://localhost:1248`.
3. **Communication:** Use WebSockets (Socket.io) for real-time updates (Chat, Task statuses, Office UI).

---

### Phase 1: CLI & Daemon Architecture (Backend)

The system runs locally as a background daemon so agents can work even when the dashboard is closed.

* **Tech:** `pm2` (or built-in `child_process` daemonization) + `commander.js` for CLI.
* **Commands:**
* `agenthub start`: Spins up the backend Node server and NextJS dashboard in the background. Initializes the SQLite/JSON local database.
* `agenthub stop`: Gracefully halts all agent executions, saves state, and kills the background processes.
* `agenthub status`: Shows if the hub is running, current port, active project, and number of working agents.
* `agenthub logs`: Tails the system and agent execution logs.
* `agenthub clean`: Clears temporary caches and unneeded agent context logs.



---

### Phase 2: Core Dashboard UI/UX (Next.js)

* **Design System:** Modern, minimalist, Apple-like aesthetic.
* **Layout:** * **Left Sidebar:** Collapsible navigation menu.
* **Right Main Panel:** The active view workspace.
* **Persistent Bottom Bar:** Global token usage, estimated cost ($), and system status (Connected/Disconnected).



---

### Phase 3: Feature Modules Specification

#### 1. Projects Workspace

* **Data Model:** Name, Description, Local Absolute Path, Ignore Patterns (e.g., `node_modules`).
* **The `PROJECT.md` Engine:** Every project has an auto-generated `PROJECT.md` in its root.
* Agents read this first to understand architecture, tech stack, and goals.
* **Auto-Documentation:** Upon completing tasks, agents automatically append new architectural decisions, APIs, or data models to this file.


* **File Explorer:** A built-in tree view of the project's working directory in the UI.

#### 2. Kanban Task Engine

* **Columns:** Backlog → To Do → Doing → Blocked/Needs Review → Done.
* **Task Data:** Title, Description, Attachments (Images/Files), Assigned Agent, Assigned Project, Execution Logs.
* **The "YOLO" Execution Loop:**
* When a user drags a task to **"Doing"**, the assigned agent wakes up.
* The agent reads the Task Description, `PROJECT.md`, and its own `MEMORY.md`.
* **Tool Access:** Give agents local tool execution capabilities (ability to run bash commands, read/write files via standard Node `fs` and `child_process`).
* The agent works autonomously. It logs its terminal commands, file diffs, and thought processes in the "Task Details > Execution Logs" tab.
* If successful, it moves the task to **"Done"**.
* **Intervention:** It will only stop and send a notification to the user (moving to "Blocked") if a command repeatedly fails, a requested API key is missing, or it faces an unresolvable logical loop.



#### 3. Agent Chat & Notifications

* **Layout:** Left sub-panel lists all hired agents (online/offline status). Right side is the chat window.
* **Features:** * Real-time WebSocket chat.
* Notifications badge in the sidebar if an agent asks a question while working on a task.
* Context-Awareness: If an agent asks "Is this button color right?", the user can reply in the chat, and the agent resumes the task.



#### 4. The "Office" (Interactive Telemetry UI)

* **Visuals:** A 2D isometric grid or modern node-graph UI (using a canvas library or Framer Motion).
* **Elements:** * Each agent has a "Desk" (Node) with their Avatar and Name.
* **Status Indicators:** Sleeping (Zzz), Reading (Book icon), Coding (Keyboard icon), Terminal execution (Gear icon).
* **Activity Streams:** Visual data packets or lines flowing between the Agent's desk and a central "Project Server" node when they are writing files.
* Clicking an agent's desk pops up a mini-terminal showing exactly what they are thinking/typing at that exact millisecond.



#### 5. Agents Manager (HR Department)

* **Onboarding/Hiring:** Hire agents powered by Claude (Anthropic SDK) or Codex/GPT (OpenAI SDK).
* **Authentication:** Support standard API Keys AND local OAuth integration (detects if user is already logged into `claude-cli` or `gh-cli`).
* **Role Specialization:** Assign roles (e.g., "Senior React Dev", "DevOps Engineer").
* **The OpenClaw Memory Architecture:** Each agent gets a local folder with:
1. `SOUL.md`: Personality, behavioral strictness, output format preferences.
2. `USER.md`: How the user likes code written (e.g., "always use arrow functions, no semicolons").
3. `AGENTS.md`: Operational rules (e.g., "Do not delete files without backing up, always run tests before moving to Done").
4. `MEMORY.md`: Long-term memory. Uses an auto-summarization algorithm to stay compact (under 2000 tokens) so it doesn't drain context windows.



#### 6. System Settings

* **Providers:** Input fields for global API keys, custom base URLs (for local LLMs like Ollama/LMStudio).
* **Budgeting:** Set daily/monthly token or USD ($) limits to prevent runaway loops. Auto-kill agents if budget is exceeded.
* **Security:** Toggle "Require confirmation for destructive commands (rm, drop db)".
* **Preferences:** UI themes, notification sounds, default project workspace directory.
* **Memory Management:** Button to clear/prune agent `MEMORY.md` caches.

---

### 🚨 FINAL MANDATE: AUTONOMY, SCOPE & EXECUTION 🚨

**IMPORTANT: Please suggest and implement as many additional features as you can think of. Do not limit yourself strictly to what is described above—the above specification is just the foundation and core idea.** Make this system full-featured, complete, comprehensive, and ready to use in a production-like local environment.

**UI/UX Standards:** It must look nice and modern, support both dark and light modes out of the box, and be exceptionally easy to use.

**Execution Rules:**

* **Avoid asking me questions.** Implement the entire system end-to-end. You can take your time and output the code in logical chunks or steps.
* Only ask if something is completely blocking and fundamentally unclear. If you can propose a logical suggestion or make a safe assumption, **do it without asking me.**
* Start by outputting the directory structure, and then immediately proceed to output the code for the foundational files.
