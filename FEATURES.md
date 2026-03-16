# AgentWork — Feature Roadmap

97 proposed features across 15 categories.

---

## 1. Agent Capabilities & Intelligence

- [ ] **Agent-to-Agent Communication** — Agents can message each other directly, enabling a "tech lead" agent to delegate sub-tasks or review another agent's work before marking a task done.
- [ ] **Per-Agent Tool Restrictions** — Allow per-agent tool whitelists (e.g., a "QA Engineer" agent gets `run_bash` for test execution but not `write_file`, while a "Technical Writer" gets only `read_file` and `write_file`).
- [ ] **Retrieval-Augmented Generation (RAG) for Project Context** — Add vector-indexed embedding search across the project codebase so agents can retrieve relevant files on demand rather than relying on the static PROJECT.md summary.
- [ ] **Self-Improving Agent Prompts** — Track success/failure rates per agent and automatically tune the system prompt. If an agent consistently hits `request_help` or max iterations, flag the prompt/personality as needing adjustment and suggest changes to the user.
- [ ] **Agent Cloning / Templates** — Allow cloning an existing agent's configuration (personality, memory files, provider/model) to spin up a new agent with the same starting point. Also support agent templates ("Senior React Developer with Claude Opus" preset).
- [ ] **Multi-Model Fallback Chain** — If the primary model for an agent fails (rate limit, API down), automatically fall back to a secondary model. The agent configuration could have a `fallback_model` field.
- [ ] **Streaming Chat Responses** — Stream tokens to the UI in real time using Socket.io so the user sees the agent "typing" character by character, instead of waiting for the full completion.
- [ ] **Context Window Management** — Add automatic context window management that summarizes older messages when approaching the model's token limit, preventing truncation errors.
- [ ] **Agent Warm-Up / Pre-Caching** — When an agent is assigned a task, pre-load its memory files and project context into a cached session object so that execution starts faster.
- [ ] **Vision / Image Understanding** — Allow agents to analyze screenshots, diagrams, or UI mockups attached to tasks. Pass image attachments as base64 content blocks in the messages array.

## 2. Task Management & Workflow

- [ ] **Task Dependencies / Blockers** — Add a `depends_on` field to tasks so a task cannot move to "Doing" until its dependencies are in "Done." This enables DAG-based execution pipelines beyond linear Flow tasks.
- [ ] **Sub-Tasks** — Allow tasks to have nested sub-tasks (parent_id foreign key). The parent task auto-completes when all sub-tasks are done.
- [ ] **Priority Queue per Agent** — Add a priority queue per agent so when one task finishes, the next highest-priority "To Do" task auto-starts.
- [ ] **Task Templates / Recurring Blueprints** — Allow saving a task as a "template" with pre-filled title, description, agent, and project. One-click to create a new task from the template.
- [ ] **Time Estimates & SLA Tracking** — Add estimated duration per task and track actual execution time. Surface SLA violations (tasks taking 3x longer than estimated) in the dashboard.
- [ ] **Task Labels / Tags** — Add a free-form tagging system (e.g., "bug", "feature", "refactor", "urgent") for filtering and grouping tasks on the Kanban board.
- [ ] **Bulk Task Operations** — Add multi-select on the Kanban board for bulk status changes, bulk agent assignment, or bulk deletion.
- [ ] **Retry with Modified Prompt** — When a task lands in "Blocked," allow the user to edit the task description and retry execution with one click.
- [ ] **Parallel Flow Steps** — Allow marking certain flow steps as parallelizable so multiple agents can work on different steps simultaneously, with a join step that waits for all parallel branches.
- [ ] **Task Execution Timeout** — Add a configurable per-task timeout (e.g., 30 minutes) that moves the task to "Blocked" if exceeded.

## 3. UI/UX Improvements

- [ ] **Syntax-Highlighted Code Viewer** — Add syntax highlighting (Prism.js or highlight.js) to the project file viewer based on file extension.
- [ ] **Execution Log Filtering** — Add log-level filtering (show only errors, hide thinking steps), text search within logs, and timestamp-relative display.
- [ ] **In-Line File Editor** — Add the ability to edit and save files directly from the dashboard Projects page.
- [ ] **Markdown Rendering in Chat** — Render agent responses with proper markdown formatting (code blocks, lists, headers) instead of raw text.
- [ ] **Keyboard Shortcuts** — Cmd/Ctrl+K for quick task creation, Cmd+/ to toggle sidebar, Escape to close modals, arrow keys for Kanban navigation.
- [ ] **Kanban Board Swimlanes** — Add optional horizontal swimlanes by agent, project, or priority.
- [ ] **Live Activity Feed** — Replace the static "Recent Tasks" list on the home page with a real-time event stream showing task completions, agent status changes, budget alerts, and error notifications.
- [ ] **Responsive Mobile Layout** — Add a responsive hamburger menu and touch-friendly Kanban interactions for mobile screens.
- [ ] **Diff Viewer for File Changes** — Show a side-by-side diff in the execution log when agents modify files.
- [ ] **Onboarding Wizard** — A guided setup wizard for first-time users: add an API key, create a project, hire an agent, run a first task.

## 4. Monitoring, Observability & Debugging

- [ ] **Cost Breakdown by Agent / Model / Task** — Add spend breakdowns by agent, by model, and by task so users can see which is most expensive.
- [ ] **Cost Charts & Sparklines** — Interactive charts for daily spend over time, per-agent distribution, and token usage trends.
- [ ] **Execution Replay** — Store full execution traces with timestamps and allow replaying them step-by-step to debug agent decisions.
- [ ] **Agent Performance Metrics** — Track per-agent stats: average task completion time, success rate, average tokens per task, number of iterations, and times blocked.
- [ ] **Error Alerting & Escalation** — Send push notifications via Telegram/Slack to the user when tasks fail. Add webhook support for external alerting (PagerDuty, Discord, email).
- [ ] **Health Check Endpoint** — Add `/api/health` that verifies database connectivity, disk space, memory usage, and active bot connections.
- [ ] **Full AI Request/Response Logging** — Optional verbose logging that captures the full prompt and response for each AI API call, for debugging and prompt optimization.
- [ ] **Execution Timeline / Gantt Chart** — Show a timeline of when each agent was active, what tasks they worked on, and for how long in The Office view.

## 5. Security & Access Control

- [ ] **API Key Encryption at Rest** — Encrypt API keys in the SQLite settings table using OS keychain or a local encryption key.
- [ ] **Dashboard Authentication** — Add optional password protection or local-only binding so the dashboard isn't open to anyone on the network.
- [ ] **Command Sandboxing** — Configurable restrictions for agent commands: blocked patterns (rm -rf /, DROP TABLE), directory jail, optional Docker container isolation.
- [ ] **Audit Log** — Record all user actions (settings changes, agent creation/deletion, task modifications) in a separate audit log table with timestamps.
- [ ] **Per-Agent Budget Limits** — Individual daily spend caps per agent (e.g., Opus agent at $5/day, Haiku agent at $20/day).
- [ ] **Path Traversal Protection** — Restrict the file read API to registered project directories only, preventing access to sensitive system files.

## 6. Integrations

- [ ] **Discord Bot** — Add Discord as a third platform option alongside Telegram and Slack.
- [ ] **GitHub Integration** — Auto-create issues from blocked tasks, auto-create PRs from completed tasks, sync task status with GitHub project boards, trigger tasks on webhook events.
- [ ] **Linear / Jira Sync** — Bidirectional sync between the AgentWork Kanban board and external project management tools.
- [ ] **Webhook API for External Triggers** — Inbound endpoint (`POST /api/webhooks/trigger`) that creates and/or executes a task from CI/CD, GitHub Actions, or other systems.
- [ ] **Email Notifications** — Allow agents to send email via SMTP or SendGrid for task completion reports and daily summaries.
- [ ] **VS Code Extension** — Companion extension showing agent activity, quick task creation from the editor, and execution logs in a VS Code panel.
- [ ] **Native Google Gemini SDK** — Add `@google/generative-ai` for proper Gemini API support beyond the OpenAI compatibility layer.
- [ ] **MCP (Model Context Protocol) Tool Server** — Expose AgentWork tasks, agents, and projects as MCP resources and tools for Claude Desktop and other MCP clients.

## 7. Developer Experience

- [ ] **REST API Documentation** — Auto-generated Swagger/OpenAPI docs for the full API surface.
- [ ] **CLI Task Management** — Add `agentwork task create/list`, `agentwork agent list` commands for scripting agent workflows from the terminal.
- [ ] **Hot Reload for Server** — Add nodemon or file watcher for server-side code changes in dev mode.
- [ ] **TypeScript Migration** — Add TypeScript or JSDoc type annotations for better IDE support and fewer runtime errors.
- [ ] **Test Suite** — Unit tests for AI service, executor logic, scheduler, and integration tests for API routes.
- [ ] **Plugin System** — Allow third-party plugins that register new agent tools, platform integrations, or custom task types without modifying core code.
- [ ] **Env Var Override for All Settings** — Allow all settings (API keys, budgets) to be set via environment variables for Docker/CI deployments.

## 8. Performance & Reliability

- [ ] **Proper Database Migrations** — Versioned migration files instead of ad-hoc ALTER TABLE statements on startup.
- [ ] **Execution Queue with Concurrency Limits** — Configurable max concurrent agent executions (e.g., 3) to prevent resource exhaustion and API rate limits.
- [ ] **Graceful Task Recovery on Restart** — On startup, detect orphaned "doing" tasks and move them back to "todo" or "blocked."
- [ ] **Log Rotation & Size Limits** — Cap stored execution logs per task, archive older entries to files.
- [ ] **AI API Rate Limiting** — Configurable per-provider request throttling when multiple agents work simultaneously.
- [ ] **Persistent Agent Sessions** — Persist CLI-mode chat session IDs to the database so agents can resume conversations after daemon restart.

## 9. Data & Analytics

- [ ] **Analytics Dashboard Page** — Dedicated `/analytics` page with completion trends, agent utilization, cost charts, model comparison, and peak usage hours.
- [ ] **Data Export** — CSV/JSON export for tasks, execution logs, budget history, and agent performance data.
- [ ] **Usage Report Generation** — Auto-generated weekly/monthly summaries: total spend, tasks per agent, top models by cost-efficiency, blocked task root causes.
- [ ] **Project Health Score** — Composite score per project based on task completion rates, average completion time, recent activity, and code change velocity.

## 10. Collaboration & Team Features

- [ ] **Multi-User Support** — User accounts with admin/operator/viewer roles for shared AgentWork instances.
- [ ] **Agent Assignment Suggestions** — AI-powered agent recommendation for new tasks based on description, role, past performance, and workload.
- [ ] **Shared Agent Memory** — TEAM.md shared across agents on the same project so knowledge discovered by one agent is available to all.
- [ ] **Task Comments / Activity Log** — Discussion thread on each task, separate from execution logs, for user notes and instructions.
- [ ] **@-Mention Agents in Task Descriptions** — Reference agents by name to notify them or add them as collaborators.

## 11. Automation & CI/CD

- [ ] **Git Hook Integration** — Trigger agent tasks on git push/merge events (e.g., auto-run QA agent on every push).
- [ ] **Visual Pipeline Builder** — Drag-and-drop DAG editor with conditional branches, parallel steps, and merge gates.
- [ ] **Auto-PR Creation** — After task completion, auto-create a git branch, commit agent changes, and open a PR on GitHub/GitLab.
- [ ] **Scheduled Reports** — Cron-triggered tasks that generate and send reports (test results, code quality, dependency audit) to platforms.

## 12. File & Code Management

- [ ] **Git Status in File Explorer** — Show modified/untracked/staged indicators on files in the project tree.
- [ ] **File Search in Projects** — Filename and full-text content search within a project.
- [ ] **Multi-File Diff Review** — Consolidated PR-style diff view of all agent changes after task completion.
- [ ] **PROJECT.md Regeneration** — One-click button to refresh the auto-generated PROJECT.md for a project.

## 13. Configuration & Customization

- [ ] **Custom Agent Tools** — User-defined tools with name, description, parameters, and a bash command template, added to specific agents.
- [ ] **Configurable Max Iterations** — Per-task or global iteration limit instead of the hardcoded 30.
- [ ] **Custom Accent Colors** — Theme customization with preset color schemes (purple, green, orange) beyond dark/light.
- [ ] **Granular Notification Preferences** — Per-event-type controls: task complete, task blocked, budget threshold, quiet hours.
- [ ] **Per-Project Default Agent** — Auto-assign a specific agent when creating new tasks for a project.
- [ ] **Custom Memory Files** — Add project-specific memory files beyond the standard 4 (SOUL, USER, AGENTS, MEMORY).

## 14. Communication

- [ ] **Group Chat** — Multi-agent chat rooms for brainstorming sessions where the user discusses a topic and agents respond by expertise.
- [ ] **Chat History Search** — Full-text search across all conversation history with any agent.
- [ ] **Rich Messages** — Support images, files, and code snippets in chat messages (user-to-agent and agent-to-user).
- [ ] **Chat Export** — Export conversation history as Markdown or PDF.
- [ ] **Proactive Agent Notifications** — Agents initiate alerts based on scheduled scans (e.g., "test suite is failing" or "dependency has a CVE").

## 15. Mobile & Accessibility

- [ ] **Progressive Web App (PWA)** — Add manifest.json and service worker for installable mobile experience with push notifications.
- [ ] **Touch-Friendly Kanban** — Proper touch drag-and-drop using dnd-kit's touch sensors.
- [ ] **Accessible Color Contrast** — Audit and fix WCAG AA compliance across both themes.
- [ ] **Screen Reader Support** — ARIA labels on interactive elements and semantic HTML landmarks.
