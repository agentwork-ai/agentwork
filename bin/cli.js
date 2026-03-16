#!/usr/bin/env node

const { Command } = require('commander');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk');

const os = require('os');

const program = new Command();
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.AGENTWORK_DATA || path.join(os.homedir(), '.agentwork');
const PID_FILE = path.join(DATA_DIR, 'agentwork.pid');
const LOG_FILE = path.join(DATA_DIR, 'logs', 'agentwork.log');

fs.mkdirSync(path.join(DATA_DIR, 'logs'), { recursive: true });

function isRunning() {
  if (!fs.existsSync(PID_FILE)) return false;
  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim());
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    fs.unlinkSync(PID_FILE);
    return false;
  }
}

program
  .name('agentwork')
  .description('AgentWork - Autonomous AI Agent Orchestrator')
  .version('1.0.0');

program
  .command('start')
  .description('Start AgentWork daemon and dashboard')
  .option('-p, --port <port>', 'Port to run on', '1248')
  .option('-f, --foreground', 'Run in foreground (no daemon)')
  .action((opts) => {
    const pid = isRunning();
    if (pid) {
      console.log(chalk.yellow(`AgentWork is already running (PID: ${pid})`));
      console.log(chalk.gray(`Dashboard: http://localhost:${opts.port}`));
      return;
    }

    console.log(chalk.blue.bold('🚀 Starting AgentWork...'));

    const serverScript = path.join(ROOT, 'server', 'index.js');
    const env = { ...process.env, PORT: opts.port, AGENTWORK_ROOT: ROOT };

    if (opts.foreground) {
      const child = spawn('node', [serverScript], {
        env,
        stdio: 'inherit',
      });
      child.on('exit', (code) => {
        if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
        process.exit(code);
      });
      fs.writeFileSync(PID_FILE, String(child.pid));
      return;
    }

    const logStream = fs.openSync(LOG_FILE, 'a');
    const child = spawn('node', [serverScript], {
      env,
      detached: true,
      stdio: ['ignore', logStream, logStream],
    });
    child.unref();

    fs.writeFileSync(PID_FILE, String(child.pid));

    // Wait a moment, then confirm
    setTimeout(() => {
      const running = isRunning();
      if (running) {
        console.log(chalk.green.bold('✓ AgentWork started successfully'));
        console.log(chalk.gray(`  PID:       ${running}`));
        console.log(chalk.gray(`  Dashboard: http://localhost:${opts.port}`));
        console.log(chalk.gray(`  Logs:      ${LOG_FILE}`));
      } else {
        console.log(chalk.red('✗ Failed to start AgentWork. Check logs:'));
        console.log(chalk.gray(`  ${LOG_FILE}`));
      }
    }, 2000);
  });

program
  .command('stop')
  .description('Stop AgentWork daemon')
  .action(() => {
    const pid = isRunning();
    if (!pid) {
      console.log(chalk.yellow('AgentWork is not running.'));
      return;
    }

    console.log(chalk.blue(`Stopping AgentWork (PID: ${pid})...`));
    try {
      process.kill(pid, 'SIGTERM');
      // Give it a moment to shut down
      let attempts = 0;
      const check = setInterval(() => {
        attempts++;
        try {
          process.kill(pid, 0);
          if (attempts > 10) {
            process.kill(pid, 'SIGKILL');
            clearInterval(check);
          }
        } catch {
          clearInterval(check);
          if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
          console.log(chalk.green.bold('✓ AgentWork stopped.'));
        }
      }, 500);
    } catch (err) {
      if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
      console.log(chalk.green('AgentWork stopped.'));
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

    const port = process.env.PORT || 1248;
    console.log(chalk.green.bold('● AgentWork is running'));
    console.log(chalk.gray(`  PID:       ${pid}`));
    console.log(chalk.gray(`  Dashboard: http://localhost:${port}`));

    // Try to get status from the API
    const http = require('http');
    const req = http.get(`http://localhost:${port}/api/status`, (res) => {
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

program.parse();
