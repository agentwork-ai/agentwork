#!/usr/bin/env node

const { Command } = require('commander');
const { spawn, spawnSync, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk');

const os = require('os');
const http = require('http');

const PACKAGE_JSON = require('../package.json');
const program = new Command();
const ROOT = path.resolve(__dirname, '..');
const PACKAGE_NAME = PACKAGE_JSON.name;
const DATA_DIR = process.env.AGENTWORK_DATA || path.join(os.homedir(), '.agentwork');
const PID_FILE = path.join(DATA_DIR, 'agentwork.pid');
const LOG_FILE = path.join(DATA_DIR, 'logs', 'agentwork.log');
const RUNTIME_FILE = path.join(DATA_DIR, 'runtime.json');
const DEFAULT_PORT = process.env.PORT || 1248;

fs.mkdirSync(path.join(DATA_DIR, 'logs'), { recursive: true });

function normalizePort(value) {
  const port = parseInt(String(value || DEFAULT_PORT), 10);
  return Number.isFinite(port) && port > 0 ? String(port) : String(DEFAULT_PORT);
}

function loadRuntimeState() {
  try {
    if (!fs.existsSync(RUNTIME_FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(RUNTIME_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function saveRuntimeState(state) {
  fs.writeFileSync(
    RUNTIME_FILE,
    `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`
  );
}

function clearRuntimeArtifacts() {
  if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  if (fs.existsSync(RUNTIME_FILE)) fs.unlinkSync(RUNTIME_FILE);
}

function resolveServerPort(fallback = DEFAULT_PORT) {
  return normalizePort(loadRuntimeState()?.port || fallback);
}

function readInstalledVersion() {
  try {
    const file = path.join(ROOT, 'package.json');
    return JSON.parse(fs.readFileSync(file, 'utf8'))?.version || null;
  } catch {
    return null;
  }
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

// ── HTTP helper ──────────────────────────────────────────────────────────────

function apiRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: resolveServerPort(),
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error(`Invalid JSON response (HTTP ${res.statusCode})`));
        }
      });
    });

    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        reject(new Error('Cannot connect to AgentWork server. Is it running? Try: agentwork start'));
      } else {
        reject(err);
      }
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// ── Formatting helpers ───────────────────────────────────────────────────────

function statusBadge(status) {
  const map = {
    backlog: chalk.gray('backlog'),
    todo: chalk.blue('todo'),
    doing: chalk.yellow.bold('doing'),
    review: chalk.magenta('review'),
    done: chalk.green('done'),
    idle: chalk.gray('idle'),
    busy: chalk.yellow.bold('busy'),
    offline: chalk.red('offline'),
    error: chalk.red.bold('error'),
  };
  return map[status] || chalk.white(status);
}

function priorityBadge(priority) {
  const map = {
    low: chalk.gray('low'),
    medium: chalk.cyan('medium'),
    high: chalk.yellow('high'),
    urgent: chalk.red.bold('urgent'),
  };
  return map[priority] || chalk.white(priority);
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len - 1) + '\u2026' : str;
}

function padRight(str, len) {
  // Strip ANSI codes for length calculation
  const stripped = str.replace(/\x1b\[[0-9;]*m/g, '');
  const pad = Math.max(0, len - stripped.length);
  return str + ' '.repeat(pad);
}

// ── Daemon helpers ───────────────────────────────────────────────────────────

function isRunning() {
  if (!fs.existsSync(PID_FILE)) return false;
  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim());
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    clearRuntimeArtifacts();
    return false;
  }
}

function waitForExit(pid, timeoutMs = 5000, intervalMs = 250) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      try {
        process.kill(pid, 0);
        if (Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer);
          resolve(false);
        }
      } catch {
        clearInterval(timer);
        resolve(true);
      }
    }, intervalMs);
  });
}

async function stopAgentWork({ silent = false } = {}) {
  const pid = isRunning();
  if (!pid) {
    if (!silent) console.log(chalk.yellow('AgentWork is not running.'));
    return false;
  }

  if (!silent) console.log(chalk.blue(`Stopping AgentWork (PID: ${pid})...`));

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    clearRuntimeArtifacts();
    if (!silent) console.log(chalk.green('AgentWork stopped.'));
    return true;
  }

  let stopped = await waitForExit(pid, 5000);
  if (!stopped) {
    if (!silent) console.log(chalk.yellow('Graceful shutdown timed out. Sending SIGKILL...'));
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
    stopped = await waitForExit(pid, 1500);
  }

  if (!stopped) {
    if (!silent) console.log(chalk.red('✗ Failed to stop AgentWork.'));
    return false;
  }

  clearRuntimeArtifacts();
  if (!silent) console.log(chalk.green.bold('✓ AgentWork stopped.'));
  return true;
}

function ensureDashboardBuild(env) {
  const nextDir = path.join(ROOT, '.next');
  if (fs.existsSync(nextDir)) return;

  console.log(chalk.yellow('First run — building dashboard (this may take a minute)...'));
  try {
    const nextBin = path.join(ROOT, 'node_modules', '.bin', 'next');
    execSync(`"${nextBin}" build`, { cwd: ROOT, stdio: 'inherit', env });
    console.log(chalk.green('✓ Build complete'));
  } catch {
    console.log(chalk.red('✗ Build failed. Try running manually:'));
    console.log(chalk.gray(`  cd ${ROOT} && npx next build`));
    process.exit(1);
  }
}

function startAgentWork({ port = DEFAULT_PORT, foreground = false } = {}) {
  const normalizedPort = normalizePort(port);
  const pid = isRunning();
  if (pid) {
    console.log(chalk.yellow(`AgentWork is already running (PID: ${pid})`));
    console.log(chalk.gray(`Dashboard: http://localhost:${resolveServerPort(normalizedPort)}`));
    return false;
  }

  console.log(chalk.blue.bold('🚀 Starting AgentWork...'));

  const serverScript = path.join(ROOT, 'server', 'index.js');
  const env = { ...process.env, PORT: normalizedPort, AGENTWORK_ROOT: ROOT, NODE_ENV: 'production' };

  ensureDashboardBuild(env);

  if (foreground) {
    const child = spawn('node', [serverScript], {
      cwd: ROOT,
      env,
      stdio: 'inherit',
    });
    fs.writeFileSync(PID_FILE, String(child.pid));
    saveRuntimeState({ pid: child.pid, port: normalizedPort, root: ROOT, mode: 'foreground' });
    child.on('exit', (code) => {
      clearRuntimeArtifacts();
      process.exit(code);
    });
    return true;
  }

  const logStream = fs.openSync(LOG_FILE, 'a');
  const child = spawn('node', [serverScript], {
    cwd: ROOT,
    env,
    detached: true,
    stdio: ['ignore', logStream, logStream],
  });
  child.unref();

  fs.writeFileSync(PID_FILE, String(child.pid));
  saveRuntimeState({ pid: child.pid, port: normalizedPort, root: ROOT, mode: 'daemon' });

  setTimeout(() => {
    const running = isRunning();
    if (running) {
      console.log(chalk.green.bold('✓ AgentWork started successfully'));
      console.log(chalk.gray(`  PID:       ${running}`));
      console.log(chalk.gray(`  Dashboard: http://localhost:${normalizedPort}`));
      console.log(chalk.gray(`  Logs:      ${LOG_FILE}`));
    } else {
      console.log(chalk.red('✗ Failed to start AgentWork. Check logs:'));
      console.log(chalk.gray(`  ${LOG_FILE}`));
    }
  }, 2000);

  return true;
}

program
  .name('agentwork')
  .description('AgentWork - Autonomous AI Agent Orchestrator')
  .version(PACKAGE_JSON.version);

program
  .command('start')
  .description('Start AgentWork daemon and dashboard')
  .option('-p, --port <port>', 'Port to run on', '1248')
  .option('-f, --foreground', 'Run in foreground (no daemon)')
  .action((opts) => {
    startAgentWork({ port: opts.port, foreground: opts.foreground });
  });

program
  .command('stop')
  .description('Stop AgentWork daemon')
  .action(async () => {
    const stopped = await stopAgentWork();
    if (stopped === false && isRunning()) process.exit(1);
  });

program
  .command('restart')
  .description('Restart AgentWork daemon and dashboard')
  .option('-p, --port <port>', 'Port to run on (defaults to the previous port if known)')
  .option('-f, --foreground', 'Run in foreground after restart')
  .action(async (opts) => {
    const previous = loadRuntimeState();
    const targetPort = normalizePort(opts.port || previous?.port || DEFAULT_PORT);
    const wasRunning = Boolean(isRunning());

    if (wasRunning) {
      const stopped = await stopAgentWork();
      if (!stopped) process.exit(1);
    } else {
      console.log(chalk.yellow('AgentWork is not running. Starting a fresh instance.'));
    }

    startAgentWork({ port: targetPort, foreground: opts.foreground });
  });

program
  .command('update')
  .description('Update AgentWork to the latest npm release')
  .option('-t, --tag <tag>', 'npm dist-tag or explicit version', 'latest')
  .option('--no-restart', 'Do not restart AgentWork after updating if it is currently running')
  .action(async (opts) => {
    const wasRunning = Boolean(isRunning());
    const previous = loadRuntimeState();
    const targetPort = normalizePort(previous?.port || DEFAULT_PORT);
    const packageSpec = opts.tag && opts.tag !== 'latest'
      ? `${PACKAGE_NAME}@${opts.tag}`
      : `${PACKAGE_NAME}@latest`;

    if (wasRunning && opts.restart) {
      const stopped = await stopAgentWork();
      if (!stopped) process.exit(1);
    }

    console.log(chalk.blue(`Updating ${PACKAGE_NAME} (${packageSpec})...`));
    const result = spawnSync(npmCommand(), ['install', '-g', packageSpec], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    });

    if (result.error) {
      if (wasRunning && opts.restart) {
        console.log(chalk.yellow('Update failed. Attempting to restore the previous daemon...'));
        startAgentWork({ port: targetPort, foreground: false });
      }
      console.error(chalk.red(`Error: ${result.error.message}`));
      process.exit(1);
    }

    if (result.status !== 0) {
      if (wasRunning && opts.restart) {
        console.log(chalk.yellow('Update failed. Attempting to restore the previous daemon...'));
        startAgentWork({ port: targetPort, foreground: false });
      }
      process.exit(result.status || 1);
    }

    const updatedVersion = readInstalledVersion();
    console.log(chalk.green.bold(`✓ AgentWork updated${updatedVersion ? ` to v${updatedVersion}` : ''}`));

    if (wasRunning) {
      if (opts.restart) {
        console.log(chalk.blue(`Restarting AgentWork on port ${targetPort}...`));
        startAgentWork({ port: targetPort, foreground: false });
      } else {
        console.log(chalk.yellow('Restart AgentWork to apply the update: agentwork restart'));
      }
    } else {
      console.log(chalk.gray('Run `agentwork start` to launch the updated version.'));
    }
  });

program
  .command('status')
  .description('Show AgentWork status')
  .action(() => {
    const pid = isRunning();
    if (!pid) {
      console.log(chalk.red.bold('● AgentWork is not running'));
      return;
    }

    console.log(chalk.green.bold('● AgentWork is running'));
    console.log(chalk.gray(`  PID:       ${pid}`));
    console.log(chalk.gray(`  Dashboard: http://localhost:${resolveServerPort()}`));

    // Try to get status from the API
    const req = http.get(`http://localhost:${resolveServerPort()}/api/status`, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const status = JSON.parse(data);
          console.log(chalk.gray(`  Agents:    ${status.activeAgents || 0} active`));
          console.log(chalk.gray(`  Tasks:     ${status.activeTasks || 0} in progress`));
          if (status.activeProject) {
            console.log(chalk.gray(`  Project:   ${status.activeProject}`));
          }
        } catch {}
      });
    });
    req.on('error', () => {});
    req.end();
  });

program
  .command('logs')
  .description('Tail AgentWork logs')
  .option('-n, --lines <lines>', 'Number of lines to show', '50')
  .option('-f, --follow', 'Follow log output')
  .action((opts) => {
    if (!fs.existsSync(LOG_FILE)) {
      console.log(chalk.yellow('No logs found.'));
      return;
    }

    const args = ['-n', opts.lines];
    if (opts.follow) args.push('-f');
    args.push(LOG_FILE);

    const tail = spawn('tail', args, { stdio: 'inherit' });
    tail.on('error', () => {
      // Fallback: read last N lines
      const content = fs.readFileSync(LOG_FILE, 'utf8');
      const lines = content.split('\n').slice(-parseInt(opts.lines));
      console.log(lines.join('\n'));
    });
  });

program
  .command('clean')
  .description('Clear temporary caches and logs')
  .action(() => {
    const pid = isRunning();
    if (pid) {
      console.log(chalk.yellow('Please stop AgentWork first: agentwork stop'));
      return;
    }

    let cleaned = 0;
    // Clean log file
    if (fs.existsSync(LOG_FILE)) {
      fs.unlinkSync(LOG_FILE);
      cleaned++;
    }

    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
      cleaned++;
    }

    if (fs.existsSync(RUNTIME_FILE)) {
      fs.unlinkSync(RUNTIME_FILE);
      cleaned++;
    }

    // Clean temp agent context logs
    const agentsDir = path.join(DATA_DIR, 'agents');
    if (fs.existsSync(agentsDir)) {
      const agents = fs.readdirSync(agentsDir);
      for (const agent of agents) {
        const contextLog = path.join(agentsDir, agent, 'context.log');
        if (fs.existsSync(contextLog)) {
          fs.unlinkSync(contextLog);
          cleaned++;
        }
      }
    }

    console.log(chalk.green(`✓ Cleaned ${cleaned} file(s).`));
  });

// ── Task commands ────────────────────────────────────────────────────────────

const taskCmd = program
  .command('task')
  .description('Manage tasks');

taskCmd
  .command('list')
  .description('List tasks')
  .option('-s, --status <status>', 'Filter by status (backlog, todo, doing, review, done)')
  .option('-a, --agent <agent_id>', 'Filter by agent ID')
  .option('-p, --project <project_id>', 'Filter by project ID')
  .action(async (opts) => {
    try {
      const params = new URLSearchParams();
      if (opts.status) params.set('status', opts.status);
      if (opts.agent) params.set('agent_id', opts.agent);
      if (opts.project) params.set('project_id', opts.project);

      const qs = params.toString();
      const tasks = await apiRequest('GET', `/api/tasks${qs ? '?' + qs : ''}`);

      if (tasks.length === 0) {
        console.log(chalk.yellow('No tasks found.'));
        return;
      }

      // Table header
      const colId = 8;
      const colStatus = 10;
      const colPriority = 10;
      const colTitle = 40;
      const colAgent = 20;
      const colProject = 18;

      console.log('');
      console.log(
        chalk.bold(
          padRight('ID', colId) +
          padRight('STATUS', colStatus) +
          padRight('PRIORITY', colPriority) +
          padRight('TITLE', colTitle) +
          padRight('AGENT', colAgent) +
          padRight('PROJECT', colProject)
        )
      );
      console.log(chalk.gray('-'.repeat(colId + colStatus + colPriority + colTitle + colAgent + colProject)));

      for (const t of tasks) {
        const shortId = t.id.slice(0, 7);
        console.log(
          padRight(chalk.gray(shortId), colId) +
          padRight(statusBadge(t.status), colStatus) +
          padRight(priorityBadge(t.priority), colPriority) +
          padRight(truncate(t.title, colTitle - 2), colTitle) +
          padRight(truncate(t.agent_name || '-', colAgent - 2), colAgent) +
          padRight(truncate(t.project_name || '-', colProject - 2), colProject)
        );
      }

      console.log('');
      console.log(chalk.gray(`${tasks.length} task(s) total`));
    } catch (err) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

taskCmd
  .command('create <title>')
  .description('Create a new task')
  .option('-d, --description <text>', 'Task description')
  .option('--priority <priority>', 'Priority: low, medium, high, urgent', 'medium')
  .option('-a, --agent <agent_id>', 'Assign to agent by ID')
  .option('-p, --project <project_id>', 'Assign to project by ID')
  .option('-s, --status <status>', 'Initial status (backlog, todo)', 'backlog')
  .action(async (title, opts) => {
    try {
      const body = {
        title,
        description: opts.description || '',
        priority: opts.priority,
        status: opts.status,
      };
      if (opts.agent) body.agent_id = opts.agent;
      if (opts.project) body.project_id = opts.project;

      const task = await apiRequest('POST', '/api/tasks', body);

      console.log('');
      console.log(chalk.green.bold('Task created successfully'));
      console.log('');
      console.log(`  ${chalk.bold('ID:')}          ${task.id}`);
      console.log(`  ${chalk.bold('Title:')}       ${task.title}`);
      console.log(`  ${chalk.bold('Status:')}      ${statusBadge(task.status)}`);
      console.log(`  ${chalk.bold('Priority:')}    ${priorityBadge(task.priority)}`);
      if (task.description) {
        console.log(`  ${chalk.bold('Description:')} ${truncate(task.description, 60)}`);
      }
      if (task.agent_name) {
        console.log(`  ${chalk.bold('Agent:')}       ${task.agent_name}`);
      }
      if (task.project_name) {
        console.log(`  ${chalk.bold('Project:')}     ${task.project_name}`);
      }
      console.log('');
    } catch (err) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

// ── Agent commands ───────────────────────────────────────────────────────────

const agentCmd = program
  .command('agent')
  .description('Manage agents');

agentCmd
  .command('list')
  .description('List all agents')
  .action(async () => {
    try {
      const agents = await apiRequest('GET', '/api/agents');

      if (agents.length === 0) {
        console.log(chalk.yellow('No agents found.'));
        return;
      }

      const colAvatar = 4;
      const colName = 22;
      const colStatus = 10;
      const colRole = 30;
      const colProvider = 14;
      const colModel = 28;

      console.log('');
      console.log(
        chalk.bold(
          padRight('', colAvatar) +
          padRight('NAME', colName) +
          padRight('STATUS', colStatus) +
          padRight('ROLE', colRole) +
          padRight('PROVIDER', colProvider) +
          padRight('MODEL', colModel)
        )
      );
      console.log(chalk.gray('-'.repeat(colAvatar + colName + colStatus + colRole + colProvider + colModel)));

      for (const a of agents) {
        console.log(
          padRight(a.avatar || '', colAvatar) +
          padRight(truncate(a.name, colName - 2), colName) +
          padRight(statusBadge(a.status), colStatus) +
          padRight(truncate(a.role || '-', colRole - 2), colRole) +
          padRight(truncate(a.provider || '-', colProvider - 2), colProvider) +
          padRight(truncate(a.model || '-', colModel - 2), colModel)
        );
      }

      console.log('');
      console.log(chalk.gray(`${agents.length} agent(s) total`));
    } catch (err) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

program.parse();
