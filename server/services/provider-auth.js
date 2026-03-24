const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { db } = require('../db');
const { encrypt, decrypt, isSensitiveKey } = require('../crypto');

const CODEX_PROVIDER = 'openai-codex';
const GEMINI_CLI_PROVIDER = 'google-gemini-cli';
const ANTHROPIC_PROVIDER = 'anthropic';
const GOOGLE_PROVIDER = 'google';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_OAUTH_CLIENT_ID_KEYS = ['OPENCLAW_GEMINI_OAUTH_CLIENT_ID', 'GEMINI_CLI_OAUTH_CLIENT_ID'];
const GOOGLE_OAUTH_CLIENT_SECRET_KEYS = [
  'OPENCLAW_GEMINI_OAUTH_CLIENT_SECRET',
  'GEMINI_CLI_OAUTH_CLIENT_SECRET',
];

const UPSERT_PROFILE = db.prepare(
  `INSERT INTO provider_auth_profiles (provider, payload, updated_at)
   VALUES (?, ?, CURRENT_TIMESTAMP)
   ON CONFLICT(provider) DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP`
);
const GET_PROFILE = db.prepare(
  'SELECT provider, payload, updated_at FROM provider_auth_profiles WHERE provider = ?'
);
const GET_PROFILES = db.prepare(
  'SELECT provider, payload, updated_at FROM provider_auth_profiles ORDER BY provider ASC'
);
const DELETE_PROFILE = db.prepare('DELETE FROM provider_auth_profiles WHERE provider = ?');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return '';
  return isSensitiveKey(key) ? decrypt(row.value) : row.value;
}

function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function decodeEmailFromIdToken(idToken) {
  const payload = decodeJwtPayload(idToken);
  return typeof payload?.email === 'string' ? payload.email : undefined;
}

function decodeExpiryFromJwt(token) {
  const payload = decodeJwtPayload(token);
  if (typeof payload?.exp === 'number' && Number.isFinite(payload.exp) && payload.exp > 0) {
    return payload.exp * 1000;
  }
  return null;
}

function loadProfile(provider) {
  const row = GET_PROFILE.get(provider);
  if (!row) return null;
  try {
    return {
      provider,
      updatedAt: row.updated_at,
      ...JSON.parse(decrypt(row.payload)),
    };
  } catch {
    return null;
  }
}

function saveProfile(provider, payload) {
  UPSERT_PROFILE.run(provider, encrypt(JSON.stringify(payload)));
  return loadProfile(provider);
}

function deleteProfile(provider) {
  DELETE_PROFILE.run(provider);
}

function listProfiles() {
  return GET_PROFILES.all().map((row) => {
    try {
      return {
        provider: row.provider,
        updatedAt: row.updated_at,
        ...JSON.parse(decrypt(row.payload)),
      };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function isExpired(expires) {
  return typeof expires === 'number' && Number.isFinite(expires) && expires <= Date.now();
}

function summarizeProfile(profile) {
  if (!profile) return null;
  return {
    configured: true,
    source: profile.source || 'manual',
    email: profile.email,
    projectId: profile.projectId,
    expiresAt: typeof profile.expires === 'number' ? new Date(profile.expires).toISOString() : null,
    expired: isExpired(profile.expires),
    updatedAt: profile.updatedAt || null,
  };
}

function resolveConfiguredApiKey(key) {
  const value = getSetting(key);
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function computeCodexHome() {
  return path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
}

function computeCodexKeychainAccount(codexHome) {
  return `cli|${crypto.createHash('sha256').update(codexHome).digest('hex').slice(0, 16)}`;
}

function readCodexKeychainCredentials() {
  if (process.platform !== 'darwin') return null;

  const codexHome = computeCodexHome();
  const account = computeCodexKeychainAccount(codexHome);

  try {
    const secret = execSync(
      `security find-generic-password -s "Codex Auth" -a "${account}" -w`,
      { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    const parsed = JSON.parse(secret);
    const tokens = parsed?.tokens || {};
    const access = typeof tokens.access_token === 'string' ? tokens.access_token : '';
    const refresh = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : '';
    if (!access || !refresh) return null;

    const lastRefresh = new Date(parsed.last_refresh || Date.now()).getTime();
    const expires = decodeExpiryFromJwt(access) || (Number.isFinite(lastRefresh) ? lastRefresh + 3600_000 : Date.now() + 3600_000);

    return {
      provider: CODEX_PROVIDER,
      type: 'oauth',
      access,
      refresh,
      accountId: typeof tokens.account_id === 'string' ? tokens.account_id : undefined,
      email: decodeEmailFromIdToken(tokens.id_token),
      expires,
      source: 'macos-keychain',
    };
  } catch {
    return null;
  }
}

function readCodexFileCredentials() {
  const authPath = path.join(computeCodexHome(), 'auth.json');
  try {
    if (!fs.existsSync(authPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    const tokens = parsed?.tokens || {};
    const access = typeof tokens.access_token === 'string' ? tokens.access_token : '';
    const refresh = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : '';
    if (!access || !refresh) return null;
    const lastRefresh = new Date(parsed.last_refresh || Date.now()).getTime();
    const expires = decodeExpiryFromJwt(access) || (Number.isFinite(lastRefresh) ? lastRefresh + 3600_000 : Date.now() + 3600_000);

    return {
      provider: CODEX_PROVIDER,
      type: 'oauth',
      access,
      refresh,
      accountId: typeof tokens.account_id === 'string' ? tokens.account_id : undefined,
      email: decodeEmailFromIdToken(tokens.id_token),
      expires,
      source: 'codex-auth-json',
    };
  } catch {
    return null;
  }
}

function importCodexCliProfile() {
  const profile = readCodexKeychainCredentials() || readCodexFileCredentials();
  if (!profile) {
    throw new Error('No Codex OAuth credentials found in ~/.codex or the macOS keychain.');
  }
  return saveProfile(CODEX_PROVIDER, profile);
}

function ensureCodexCliAuthFromStoredProfile() {
  const profile = loadProfile(CODEX_PROVIDER);
  if (!profile?.access || !profile?.refresh) return false;

  const codexHome = computeCodexHome();
  const authPath = path.join(codexHome, 'auth.json');
  const payload = {
    OPENAI_API_KEY: 'oauth',
    tokens: {
      access_token: profile.access,
      refresh_token: profile.refresh,
      ...(profile.accountId ? { account_id: profile.accountId } : {}),
    },
    last_refresh: new Date().toISOString(),
  };

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(authPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  return true;
}

function readGeminiCliProfile() {
  const credsPath = path.join(os.homedir(), '.gemini', 'oauth_creds.json');
  if (!fs.existsSync(credsPath)) {
    throw new Error('No Gemini CLI OAuth credentials found in ~/.gemini/oauth_creds.json.');
  }

  const parsed = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
  const access = typeof parsed.access_token === 'string' ? parsed.access_token.trim() : '';
  const refresh = typeof parsed.refresh_token === 'string' ? parsed.refresh_token.trim() : '';
  if (!access || !refresh) {
    throw new Error('Gemini CLI OAuth credentials are incomplete.');
  }

  return {
    provider: GEMINI_CLI_PROVIDER,
    type: 'oauth',
    access,
    refresh,
    expires:
      typeof parsed.expiry_date === 'number' && Number.isFinite(parsed.expiry_date)
        ? parsed.expiry_date
        : Date.now() + 3600_000,
    email: decodeEmailFromIdToken(parsed.id_token),
    source: 'gemini-cli',
  };
}

function importGeminiCliProfile(options = {}) {
  const profile = readGeminiCliProfile();
  if (typeof options.projectId === 'string' && options.projectId.trim()) {
    profile.projectId = options.projectId.trim();
  }
  return saveProfile(GEMINI_CLI_PROVIDER, profile);
}

function findInPath(name) {
  const entries = (process.env.PATH || '').split(path.delimiter);
  const exts = process.platform === 'win32' ? ['.cmd', '.bat', '.exe', ''] : [''];
  for (const dir of entries) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function findFile(dir, filename, depth) {
  if (depth <= 0) return null;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === filename) return fullPath;
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      const found = findFile(fullPath, filename, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

function resolveGeminiCliDirs(geminiPath, resolvedPath) {
  const binDir = path.dirname(geminiPath);
  const candidates = [
    path.dirname(path.dirname(resolvedPath)),
    path.join(path.dirname(resolvedPath), 'node_modules', '@google', 'gemini-cli'),
    path.join(binDir, 'node_modules', '@google', 'gemini-cli'),
    path.join(path.dirname(binDir), 'node_modules', '@google', 'gemini-cli'),
    path.join(path.dirname(binDir), 'lib', 'node_modules', '@google', 'gemini-cli'),
  ];

  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

function resolveGoogleOAuthClientConfig() {
  for (const key of GOOGLE_OAUTH_CLIENT_ID_KEYS) {
    const value = process.env[key]?.trim();
    if (value) {
      const secret =
        GOOGLE_OAUTH_CLIENT_SECRET_KEYS.map((name) => process.env[name]?.trim()).find(Boolean) || '';
      return { clientId: value, clientSecret: secret };
    }
  }

  const geminiPath = findInPath('gemini');
  if (!geminiPath) {
    throw new Error('Gemini CLI not found. Install gemini or set GEMINI_CLI_OAUTH_CLIENT_ID.');
  }

  const resolvedPath = fs.realpathSync(geminiPath);
  const cliDirs = resolveGeminiCliDirs(geminiPath, resolvedPath);
  let source = null;

  for (const cliDir of cliDirs) {
    const candidates = [
      path.join(cliDir, 'node_modules', '@google', 'gemini-cli-core', 'dist', 'src', 'code_assist', 'oauth2.js'),
      path.join(cliDir, 'node_modules', '@google', 'gemini-cli-core', 'dist', 'code_assist', 'oauth2.js'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        source = fs.readFileSync(candidate, 'utf8');
        break;
      }
    }
    if (source) break;
    const found = findFile(cliDir, 'oauth2.js', 10);
    if (found) {
      source = fs.readFileSync(found, 'utf8');
      break;
    }
  }

  if (!source) {
    throw new Error('Could not extract Gemini OAuth client credentials from the installed Gemini CLI.');
  }

  const clientIdMatch = source.match(/(\d+-[a-z0-9]+\.apps\.googleusercontent\.com)/i);
  const clientSecretMatch = source.match(/(GOCSPX-[A-Za-z0-9_-]+)/);
  if (!clientIdMatch || !clientSecretMatch) {
    throw new Error('Gemini CLI OAuth client credentials could not be parsed.');
  }

  return {
    clientId: clientIdMatch[1],
    clientSecret: clientSecretMatch[1],
  };
}

async function refreshGeminiCliProfile(profile) {
  if (!profile?.refresh) return profile;

  const { clientId, clientSecret } = resolveGoogleOAuthClientConfig();
  if (!clientId || !clientSecret) {
    throw new Error('Gemini OAuth client credentials are not available.');
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: profile.refresh,
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini OAuth refresh failed (${res.status}): ${text || res.statusText}`);
  }

  const data = await res.json();
  const access = typeof data.access_token === 'string' ? data.access_token.trim() : '';
  if (!access) {
    throw new Error('Gemini OAuth refresh returned no access token.');
  }

  const next = {
    ...profile,
    access,
    refresh:
      typeof data.refresh_token === 'string' && data.refresh_token.trim()
        ? data.refresh_token.trim()
        : profile.refresh,
    email:
      decodeEmailFromIdToken(data.id_token) ||
      decodeEmailFromIdToken(profile.idToken) ||
      profile.email,
    expires:
      typeof data.expires_in === 'number' && Number.isFinite(data.expires_in)
        ? Date.now() + data.expires_in * 1000
        : Date.now() + 3600_000,
  };

  saveProfile(GEMINI_CLI_PROVIDER, next);
  return loadProfile(GEMINI_CLI_PROVIDER);
}

async function resolveGoogleRuntimeAuth() {
  const profile = loadProfile(GEMINI_CLI_PROVIDER);
  if (profile?.access) {
    const freshProfile =
      typeof profile.expires === 'number' && profile.expires <= Date.now() + 60_000
        ? await refreshGeminiCliProfile(profile)
        : profile;
    return {
      mode: 'oauth',
      token: freshProfile.access,
      projectId: freshProfile.projectId || '',
    };
  }

  const apiKey = resolveConfiguredApiKey('google_api_key');
  return apiKey ? { mode: 'api_key', apiKey } : null;
}

async function resolveProviderRuntimeAuth(provider) {
  if (provider === ANTHROPIC_PROVIDER) {
    const profile = loadProfile(ANTHROPIC_PROVIDER);
    if (profile?.token && !isExpired(profile.expires)) {
      return { mode: 'token', apiKey: profile.token };
    }
    const apiKey = resolveConfiguredApiKey('anthropic_api_key');
    return apiKey ? { mode: 'api_key', apiKey } : null;
  }

  if (provider === GOOGLE_PROVIDER) {
    return await resolveGoogleRuntimeAuth();
  }

  const keyMap = {
    openai: 'openai_api_key',
    openrouter: 'openrouter_api_key',
    deepseek: 'deepseek_api_key',
    mistral: 'mistral_api_key',
  };
  const key = resolveConfiguredApiKey(keyMap[provider] || 'openai_api_key');
  return key ? { mode: 'api_key', apiKey: key } : null;
}

function buildAuthOverview() {
  const anthropicProfile = loadProfile(ANTHROPIC_PROVIDER);
  const codexProfile = loadProfile(CODEX_PROVIDER);
  const geminiProfile = loadProfile(GEMINI_CLI_PROVIDER);

  return {
    providers: [
      {
        id: 'anthropic',
        label: 'Anthropic',
        methods: [
          {
            id: 'setup-token',
            label: 'Anthropic token (paste setup-token)',
            configured: Boolean(anthropicProfile?.token),
            profile: summarizeProfile(anthropicProfile),
          },
          {
            id: 'api-key',
            label: 'Anthropic API key',
            configured: Boolean(resolveConfiguredApiKey('anthropic_api_key')),
          },
        ],
      },
      {
        id: 'openai',
        label: 'OpenAI',
        methods: [
          {
            id: 'openai-codex',
            label: 'OpenAI Codex (ChatGPT OAuth)',
            configured: Boolean(codexProfile?.access && codexProfile?.refresh),
            profile: summarizeProfile(codexProfile),
          },
          {
            id: 'api-key',
            label: 'OpenAI API key',
            configured: Boolean(resolveConfiguredApiKey('openai_api_key')),
          },
        ],
      },
      {
        id: 'google',
        label: 'Google',
        methods: [
          {
            id: 'google-gemini-cli',
            label: 'Gemini CLI OAuth',
            configured: Boolean(geminiProfile?.access && geminiProfile?.refresh),
            profile: summarizeProfile(geminiProfile),
          },
          {
            id: 'api-key',
            label: 'Gemini API key',
            configured: Boolean(resolveConfiguredApiKey('google_api_key')),
          },
        ],
      },
      {
        id: 'openrouter',
        label: 'OpenRouter',
        methods: [
          {
            id: 'api-key',
            label: 'OpenRouter API key',
            configured: Boolean(resolveConfiguredApiKey('openrouter_api_key')),
          },
        ],
      },
      {
        id: 'deepseek',
        label: 'DeepSeek',
        methods: [
          {
            id: 'api-key',
            label: 'DeepSeek API key',
            configured: Boolean(resolveConfiguredApiKey('deepseek_api_key')),
          },
        ],
      },
      {
        id: 'mistral',
        label: 'Mistral',
        methods: [
          {
            id: 'api-key',
            label: 'Mistral API key',
            configured: Boolean(resolveConfiguredApiKey('mistral_api_key')),
          },
        ],
      },
    ],
  };
}

function saveAnthropicSetupToken(token) {
  const normalized = String(token || '').trim();
  if (!normalized) {
    throw new Error('Anthropic setup-token is required.');
  }
  return saveProfile(ANTHROPIC_PROVIDER, {
    provider: ANTHROPIC_PROVIDER,
    type: 'token',
    token: normalized,
    source: 'manual',
  });
}

module.exports = {
  buildAuthOverview,
  deleteProfile,
  ensureCodexCliAuthFromStoredProfile,
  importCodexCliProfile,
  importGeminiCliProfile,
  listProfiles,
  loadProfile,
  resolveProviderRuntimeAuth,
  saveAnthropicSetupToken,
};
