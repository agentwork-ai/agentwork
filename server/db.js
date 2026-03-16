const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = process.env.AGENTWORK_DATA || path.join(require('os').homedir(), '.agentwork');
const DB_DIR = path.join(DATA_DIR, 'db');

// Migrate data directory from old .agenthub location if needed
const OLD_DATA_DIR = path.join(require('os').homedir(), '.agenthub');
if (fs.existsSync(OLD_DATA_DIR) && !fs.existsSync(DATA_DIR)) {
  try { fs.renameSync(OLD_DATA_DIR, DATA_DIR); } catch {}
}

// Ensure directories exist
fs.mkdirSync(DB_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'agents'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'logs'), { recursive: true });

// Migrate DB from old location if needed
const OLD_DB = path.join(DATA_DIR, 'agentwork.db');
const DB_PATH = path.join(DB_DIR, 'agentwork.db');
if (fs.existsSync(OLD_DB) && !fs.existsSync(DB_PATH)) {
  fs.renameSync(OLD_DB, DB_PATH);
  for (const ext of ['-shm', '-wal']) {
    const old = OLD_DB + ext;
    if (fs.existsSync(old)) fs.renameSync(old, DB_PATH + ext);
  }
}
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    path TEXT NOT NULL,
    ignore_patterns TEXT DEFAULT 'node_modules,.git,dist,build,.next',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    avatar TEXT DEFAULT '🤖',
    role TEXT DEFAULT 'General Developer',
    auth_type TEXT DEFAULT 'api',
    provider TEXT DEFAULT 'anthropic',
    model TEXT DEFAULT 'claude-sonnet-4-20250514',
    status TEXT DEFAULT 'idle',
    personality TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'backlog',
    priority TEXT DEFAULT 'medium',
    agent_id TEXT,
    project_id TEXT,
    execution_logs TEXT DEFAULT '[]',
    attachments TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    sender TEXT NOT NULL,
    content TEXT NOT NULL,
    task_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS budget_logs (
    id TEXT PRIMARY KEY,
    agent_id TEXT,
    provider TEXT,
    model TEXT,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
  );
`);

// Migrate tasks table: add new columns if missing
const taskCols = db.prepare("PRAGMA table_info(tasks)").all().map((c) => c.name);
if (!taskCols.includes('completion_output')) {
  db.exec("ALTER TABLE tasks ADD COLUMN completion_output TEXT DEFAULT ''");
}
if (!taskCols.includes('trigger_type')) {
  db.exec("ALTER TABLE tasks ADD COLUMN trigger_type TEXT DEFAULT 'manual'");
}
if (!taskCols.includes('trigger_at')) {
  db.exec("ALTER TABLE tasks ADD COLUMN trigger_at TEXT DEFAULT NULL");
}
if (!taskCols.includes('trigger_cron')) {
  db.exec("ALTER TABLE tasks ADD COLUMN trigger_cron TEXT DEFAULT ''");
}
if (!taskCols.includes('task_type')) {
  db.exec("ALTER TABLE tasks ADD COLUMN task_type TEXT DEFAULT 'single'");
}
if (!taskCols.includes('flow_items')) {
  db.exec("ALTER TABLE tasks ADD COLUMN flow_items TEXT DEFAULT '[]'");
}
if (!taskCols.includes('tags')) {
  db.exec("ALTER TABLE tasks ADD COLUMN tags TEXT DEFAULT ''");
}

// Migrate projects table: add default_agent_id if missing
const projectCols = db.prepare("PRAGMA table_info(projects)").all().map((c) => c.name);
if (!projectCols.includes('default_agent_id')) {
  db.exec("ALTER TABLE projects ADD COLUMN default_agent_id TEXT DEFAULT NULL");
}

// Migrate agents table: add platform columns if missing
const agentCols = db.prepare("PRAGMA table_info(agents)").all().map((c) => c.name);
if (!agentCols.includes('chat_enabled')) {
  db.exec("ALTER TABLE agents ADD COLUMN chat_enabled INTEGER DEFAULT 0");
}
if (!agentCols.includes('chat_platform')) {
  db.exec("ALTER TABLE agents ADD COLUMN chat_platform TEXT DEFAULT ''");
}
if (!agentCols.includes('chat_token')) {
  db.exec("ALTER TABLE agents ADD COLUMN chat_token TEXT DEFAULT ''");
}
if (!agentCols.includes('chat_app_token')) {
  db.exec("ALTER TABLE agents ADD COLUMN chat_app_token TEXT DEFAULT ''");
}
if (!agentCols.includes('chat_allowed_ids')) {
  db.exec("ALTER TABLE agents ADD COLUMN chat_allowed_ids TEXT DEFAULT ''");
}

// Seed default settings if not present
const defaultSettings = {
  anthropic_api_key: '',
  openai_api_key: '',
  openrouter_api_key: '',
  deepseek_api_key: '',
  mistral_api_key: '',
  custom_base_url: '',
  daily_budget_usd: '10',
  monthly_budget_usd: '100',
  require_confirmation_destructive: 'true',
  theme: 'system',
  notification_sounds: 'true',
  default_workspace: '',
  max_iterations: '30',
  task_timeout_minutes: '0',
};

const insertSetting = db.prepare(
  'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
);

for (const [key, value] of Object.entries(defaultSettings)) {
  insertSetting.run(key, value);
}

// Create audit_logs table
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    details TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

function logAudit(action, resourceType, resourceId, details) {
  try {
    db.prepare('INSERT INTO audit_logs (action, resource_type, resource_id, details) VALUES (?, ?, ?, ?)').run(
      action, resourceType, resourceId || '', typeof details === 'string' ? details : JSON.stringify(details || '')
    );
  } catch {}
}

module.exports = { db, uuidv4, DATA_DIR, logAudit };
