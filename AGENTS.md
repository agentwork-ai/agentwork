# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the Next.js dashboard: page routes live in `src/app/`, shared UI in `src/components/`, and client helpers in `src/lib/`.  
`server/` contains the Node/Express backend: REST routes in `server/routes/`, core runtime logic in `server/services/`, and schema changes in `server/migrations/`.  
Shared metadata lives in `shared/`, static assets in `public/`, demos in `demo/`, and the packaged CLI in `bin/`. A separate VS Code integration lives under `vscode-extension/`.

## Build, Test, and Development Commands
- `npm run dev` — run the server with `nodemon` for backend-driven development.
- `npm run dev:no-reload` — run the app without auto-restart.
- `npm run build` — create the production Next.js build; use this as the main regression check.
- `npm start` — run the production server.
- `npm run lint` — run Next.js linting when touching UI-heavy code.
- `node --check path/to/file.js` — quick syntax check for targeted backend or frontend files.

## Coding Style & Naming Conventions
Use 2-space indentation, semicolons, and single quotes in JS files. Prefer small helper functions over deeply nested inline logic.  
React components use PascalCase (`TaskFormModal`), hooks/state helpers use camelCase, and route/service files use concise lowercase names (`tasks.js`, `executor.js`). Keep markdown/docs in plain ASCII unless the file already uses Unicode.

## Testing Guidelines
There is no formal automated test suite yet. For most changes, run `npm run build` and targeted `node --check` commands. For API or workflow changes, do a live smoke test against `http://localhost:1248/api/health` and the affected endpoints. Include manual verification notes for task execution, chat, meetings, or uploads when those areas change.

## Commit & Pull Request Guidelines
Follow Conventional Commits as seen in history: `feat(tasks): ...`, `fix(runtime): ...`, `docs(readme): ...`. Keep the scope short and meaningful.  
PRs should include: a brief problem/solution summary, impacted areas, verification steps, and screenshots for UI changes (Kanban, Agents, Meetings, Settings, etc.). Mention any config or provider prerequisites explicitly.

## Security & Configuration Tips
Do not hardcode API keys, OAuth tokens, or local secrets. Runtime data is stored under `~/.agentwork/`. If you add file or image handling, keep writes inside that data directory unless there is a clear product requirement otherwise.
