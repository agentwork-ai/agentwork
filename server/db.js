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
fs.mkdirSync(path.join(DATA_DIR, 'plugins'), { recursive: true });

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
    role TEXT DEFAULT 'Assistant',
    agent_type TEXT DEFAULT 'smart',
    auth_type TEXT DEFAULT 'api',
    provider TEXT DEFAULT 'anthropic',
    model TEXT DEFAULT 'claude-sonnet-4-20250514',
    status TEXT DEFAULT 'idle',
    personality TEXT DEFAULT '',
    skills_json TEXT DEFAULT '[]',
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

  CREATE TABLE IF NOT EXISTS provider_auth_profiles (
    provider TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ─── Versioned Migration System ───
db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

function runMigrations() {
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.js') && /^\d+/.test(f))
    .sort((a, b) => parseInt(a) - parseInt(b));

  for (const file of files) {
    const version = parseInt(file);
    if (applied.has(version)) continue;
    try {
      const migration = require(path.join(migrationsDir, file));
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(version, file);
      console.log(`[DB] Migration applied: ${file}`);
    } catch (err) {
      console.error(`[DB] Migration failed: ${file}:`, err.message);
      break;
    }
  }
}

// Run legacy ad-hoc migrations (kept for backwards compatibility)
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
if (!taskCols.includes('depends_on')) {
  db.exec("ALTER TABLE tasks ADD COLUMN depends_on TEXT DEFAULT '[]'");
}
if (!taskCols.includes('parent_id')) {
  db.exec("ALTER TABLE tasks ADD COLUMN parent_id TEXT DEFAULT NULL");
}
if (!taskCols.includes('estimated_minutes')) {
  db.exec("ALTER TABLE tasks ADD COLUMN estimated_minutes INTEGER DEFAULT 0");
}
if (!taskCols.includes('started_at')) {
  db.exec("ALTER TABLE tasks ADD COLUMN started_at DATETIME DEFAULT NULL");
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
if (!agentCols.includes('daily_budget_usd')) {
  db.exec("ALTER TABLE agents ADD COLUMN daily_budget_usd REAL DEFAULT 0");
}
if (!agentCols.includes('fallback_model')) {
  db.exec("ALTER TABLE agents ADD COLUMN fallback_model TEXT DEFAULT ''");
}
if (!agentCols.includes('allowed_tools')) {
  db.exec("ALTER TABLE agents ADD COLUMN allowed_tools TEXT DEFAULT ''");
}
if (!agentCols.includes('agent_type')) {
  db.exec("ALTER TABLE agents ADD COLUMN agent_type TEXT DEFAULT 'smart'");
}
if (!agentCols.includes('skills_json')) {
  db.exec("ALTER TABLE agents ADD COLUMN skills_json TEXT DEFAULT '[]'");
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
  rate_limit_ms: '0',
  max_concurrent_executions: '3',
  dashboard_password: '',
  accent_color: 'blue',
  auto_git_branch: 'true',
  auto_git_sync: 'true',
  auto_git_merge: 'true',
  auto_git_init: 'true',
  verbose_ai_logging: 'false',
  google_api_key: '',
  xai_api_key: '',
  groq_api_key: '',
  together_api_key: '',
  moonshot_api_key: '',
  ollama_api_key: '',
  ollama_base_url: 'http://127.0.0.1:11434/v1',
  smtp_host: '',
  smtp_port: '587',
  smtp_user: '',
  smtp_pass: '',
  smtp_from: '',
  notification_email: '',
  notify_task_complete: 'true',
  notify_task_blocked: 'true',
  notify_budget_threshold: 'true',
  notify_agent_messages: 'true',
  onboarding_complete: 'false',
};

// Allow env var overrides: AGENTWORK_SETTING_<KEY> (e.g., AGENTWORK_SETTING_ANTHROPIC_API_KEY)
const envPrefix = 'AGENTWORK_SETTING_';
for (const [envKey, envValue] of Object.entries(process.env)) {
  if (envKey.startsWith(envPrefix) && envValue) {
    const settingKey = envKey.slice(envPrefix.length).toLowerCase();
    defaultSettings[settingKey] = envValue;
  }
}

const insertSetting = db.prepare(
  'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
);

for (const [key, value] of Object.entries(defaultSettings)) {
  insertSetting.run(key, value);
}

// Create pipelines table
db.exec(`
  CREATE TABLE IF NOT EXISTS pipelines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    steps TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Create task_templates table
db.exec(`
  CREATE TABLE IF NOT EXISTS task_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    priority TEXT DEFAULT 'medium',
    agent_id TEXT,
    project_id TEXT,
    task_type TEXT DEFAULT 'single',
    flow_items TEXT DEFAULT '[]',
    tags TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

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

// Create task_comments table
db.exec(`
  CREATE TABLE IF NOT EXISTS task_comments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  )
`);

// Agent sessions table (persists CLI chat sessions across restarts)
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_sessions (
    agent_id TEXT PRIMARY KEY,
    session_id TEXT,
    provider TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
  )
`);

// Custom tools table (user-defined tools for agent executions)
db.exec(`
  CREATE TABLE IF NOT EXISTS custom_tools (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    command_template TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Agent-to-agent messages table (inter-agent communication)
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_messages (
    id TEXT PRIMARY KEY,
    from_agent_id TEXT NOT NULL,
    to_agent_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (from_agent_id) REFERENCES agents(id) ON DELETE CASCADE,
    FOREIGN KEY (to_agent_id) REFERENCES agents(id) ON DELETE CASCADE
  )
`);

// Group chat rooms tables
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    agent_ids TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS room_messages (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    sender_type TEXT NOT NULL,
    sender_id TEXT,
    sender_name TEXT,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE
  );
`);

function logAudit(action, resourceType, resourceId, details) {
  try {
    db.prepare('INSERT INTO audit_logs (action, resource_type, resource_id, details) VALUES (?, ?, ?, ?)').run(
      action, resourceType, resourceId || '', typeof details === 'string' ? details : JSON.stringify(details || '')
    );
  } catch {}
}

// Run versioned migrations
runMigrations();

module.exports = { db, uuidv4, DATA_DIR, logAudit };
