const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { db } = require('../db');
const { encrypt, decrypt, isSensitiveKey } = require('../crypto');

const CODEX_PROVIDER = 'openai-codex';
const GEMINI_CLI_PROVIDER = 'google-gemini-cli';
const ANTHROPIC_PROVIDER = 'anthropic';
const GOOGLE_PROVIDER = 'google';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const OPENAI_CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OPENAI_CODEX_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const OPENAI_CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OPENAI_CODEX_REDIRECT_URI = 'http://localhost:1455/auth/callback';
const OPENAI_CODEX_SCOPE = 'openid profile email offline_access';
const OPENAI_CODEX_JWT_CLAIM_PATH = 'https://api.openai.com/auth';
const CODEX_OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;
const GOOGLE_OAUTH_CLIENT_ID_KEYS = ['OPENCLAW_GEMINI_OAUTH_CLIENT_ID', 'GEMINI_CLI_OAUTH_CLIENT_ID'];
const GOOGLE_OAUTH_CLIENT_SECRET_KEYS = [
  'OPENCLAW_GEMINI_OAUTH_CLIENT_SECRET',
  'GEMINI_CLI_OAUTH_CLIENT_SECRET',
];
const codexOAuthFlows = new Map();

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

function readJsonObject(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeLastRefresh(lastRefresh) {
  if (typeof lastRefresh === 'string' && lastRefresh.trim()) return lastRefresh.trim();
  if (typeof lastRefresh === 'number' && Number.isFinite(lastRefresh) && lastRefresh > 0) {
    return new Date(lastRefresh).toISOString();
  }
  return new Date().toISOString();
}

function getLastRefreshMs(lastRefresh) {
  const ms = new Date(lastRefresh || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function toBase64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function generatePkcePair() {
  const verifier = toBase64Url(crypto.randomBytes(32));
  const challenge = toBase64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function createCodexOAuthState() {
  return crypto.randomBytes(16).toString('hex');
}

function parseAuthorizationInput(input) {
  const value = String(input || '').trim();
  if (!value) return {};

  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get('code') || undefined,
      state: url.searchParams.get('state') || undefined,
    };
  } catch {
    // Not a full URL. Keep parsing below.
  }

  if (value.includes('#')) {
    const [code, state] = value.split('#', 2);
    return {
      code: code || undefined,
      state: state || undefined,
    };
  }

  if (value.includes('code=')) {
    const params = new URLSearchParams(value);
    return {
      code: params.get('code') || undefined,
      state: params.get('state') || undefined,
    };
  }

  return { code: value };
}

function getCodexAccountId(accessToken) {
  const payload = decodeJwtPayload(accessToken);
  const authPayload = payload?.[OPENAI_CODEX_JWT_CLAIM_PATH];
  const accountId = authPayload?.chatgpt_account_id;
  return typeof accountId === 'string' && accountId.trim() ? accountId.trim() : null;
}

function renderOauthHtml(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f1115; color: #f3f4f6; margin: 0; padding: 24px; }
    .card { max-width: 560px; margin: 12vh auto 0; background: #171a21; border: 1px solid #2b3140; border-radius: 16px; padding: 24px; }
    h1 { margin: 0 0 12px; font-size: 22px; }
    p { margin: 0; line-height: 1.55; color: #c8ced8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${body}</p>
  </div>
</body>
</html>`;
}

function extractCodexProfile(parsed, source) {
  const tokens = parsed?.tokens && typeof parsed.tokens === 'object' ? parsed.tokens : {};
  const access = typeof tokens.access_token === 'string' ? tokens.access_token : '';
  const refresh = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : '';
  if (!access || !refresh) return null;

  const lastRefresh = new Date(parsed?.last_refresh || Date.now()).getTime();
  const expires =
    decodeExpiryFromJwt(access)
    || (Number.isFinite(lastRefresh) ? lastRefresh + 3600_000 : Date.now() + 3600_000);

  return {
    provider: CODEX_PROVIDER,
    type: 'oauth',
    access,
    refresh,
    accountId:
      typeof tokens.account_id === 'string' && tokens.account_id.trim()
        ? tokens.account_id.trim()
        : getCodexAccountId(access) || undefined,
    idToken: typeof tokens.id_token === 'string' ? tokens.id_token : undefined,
    tokens: { ...tokens },
    lastRefresh: normalizeLastRefresh(parsed?.last_refresh),
    email: decodeEmailFromIdToken(tokens.id_token),
    expires,
    source,
  };
}

function readCodexFileCredentials() {
  const authPath = path.join(computeCodexHome(), 'auth.json');
  const parsed = readJsonObject(authPath);
  if (!parsed) return null;
  return extractCodexProfile(parsed, 'codex-auth-json');
}

function importCodexCliProfile() {
  const profile = readCodexFileCredentials();
  if (!profile) {
    throw new Error('No Codex OAuth credentials found in ~/.codex/auth.json.');
  }
  return saveProfile(CODEX_PROVIDER, profile);
}

function mergeCodexProfiles(primary, secondary) {
  return {
    ...primary,
    ...secondary,
    provider: CODEX_PROVIDER,
    type: 'oauth',
    tokens: {
      ...(primary?.tokens && typeof primary.tokens === 'object' ? primary.tokens : {}),
      ...(secondary?.tokens && typeof secondary.tokens === 'object' ? secondary.tokens : {}),
    },
  };
}

function buildCodexProfileFromTokenResponse(data, source, previousProfile = {}) {
  const access = typeof data?.access_token === 'string' ? data.access_token.trim() : '';
  const refresh =
    typeof data?.refresh_token === 'string' && data.refresh_token.trim()
      ? data.refresh_token.trim()
      : typeof previousProfile?.refresh === 'string'
        ? previousProfile.refresh
        : '';
  const idToken =
    typeof data?.id_token === 'string' && data.id_token.trim()
      ? data.id_token.trim()
      : typeof previousProfile?.idToken === 'string'
        ? previousProfile.idToken
        : '';

  if (!access || !refresh) {
    throw new Error('OpenAI Codex OAuth returned incomplete credentials.');
  }

  const accountId = getCodexAccountId(access) || previousProfile?.accountId;
  if (!accountId) {
    throw new Error('Failed to extract accountId from the Codex OAuth token.');
  }

  const expires =
    typeof data?.expires_in === 'number' && Number.isFinite(data.expires_in)
      ? Date.now() + data.expires_in * 1000
      : decodeExpiryFromJwt(access) || Date.now() + 3600_000;

  const next = mergeCodexProfiles(previousProfile, {
    provider: CODEX_PROVIDER,
    type: 'oauth',
    access,
    refresh,
    accountId,
    idToken: idToken || undefined,
    tokens: {
      access_token: access,
      refresh_token: refresh,
      account_id: accountId,
      ...(idToken ? { id_token: idToken } : {}),
    },
    lastRefresh: new Date().toISOString(),
    email: decodeEmailFromIdToken(idToken) || previousProfile?.email,
    expires,
    source,
  });

  next.tokens = {
    ...(previousProfile?.tokens && typeof previousProfile.tokens === 'object' ? previousProfile.tokens : {}),
    ...(next.tokens && typeof next.tokens === 'object' ? next.tokens : {}),
    access_token: access,
    refresh_token: refresh,
    account_id: accountId,
    ...(idToken ? { id_token: idToken } : {}),
  };

  return next;
}

async function fetchOpenAICodexToken(body) {
  const res = await fetch(OPENAI_CODEX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });

  const text = await res.text().catch(() => '');
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = null;
  }

  if (!res.ok) {
    throw new Error(`Codex OAuth token exchange failed (${res.status}): ${text || res.statusText}`);
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Codex OAuth token exchange returned an invalid response.');
  }

  return data;
}

async function exchangeOpenAICodexAuthorizationCode(code, verifier) {
  return fetchOpenAICodexToken({
    grant_type: 'authorization_code',
    client_id: OPENAI_CODEX_CLIENT_ID,
    code,
    code_verifier: verifier,
    redirect_uri: OPENAI_CODEX_REDIRECT_URI,
  });
}

async function refreshCodexProfile(profile) {
  if (!profile?.refresh) return profile;
  const data = await fetchOpenAICodexToken({
    grant_type: 'refresh_token',
    refresh_token: profile.refresh,
    client_id: OPENAI_CODEX_CLIENT_ID,
  });
  const next = buildCodexProfileFromTokenResponse(data, 'openai-codex-refresh', profile);
  return saveProfile(CODEX_PROVIDER, next);
}

function closeCodexFlowServer(flow) {
  if (!flow?.server) return;
  try {
    flow.server.close();
  } catch {
    // Ignore best-effort cleanup errors.
  }
  flow.server = null;
}

function getCodexFlowSummary(flow) {
  if (!flow) return null;
  return {
    id: flow.id,
    status: flow.status,
    authUrl: flow.authUrl,
    callbackUrl: OPENAI_CODEX_REDIRECT_URI,
    callbackReady: Boolean(flow.callbackReady),
    manualOnly: !flow.callbackReady,
    error: flow.error || null,
    createdAt: new Date(flow.createdAt).toISOString(),
    updatedAt: new Date(flow.updatedAt).toISOString(),
  };
}

function cleanupExpiredCodexOAuthFlows() {
  const now = Date.now();
  for (const [flowId, flow] of codexOAuthFlows.entries()) {
    if (now - flow.createdAt <= CODEX_OAUTH_FLOW_TTL_MS) continue;
    closeCodexFlowServer(flow);
    codexOAuthFlows.delete(flowId);
  }
}

function getPendingCodexOAuthFlow() {
  cleanupExpiredCodexOAuthFlows();
  for (const flow of codexOAuthFlows.values()) {
    if (flow.status === 'pending') return flow;
  }
  return null;
}

async function finalizeCodexOAuthFlow(flowId, code, source) {
  cleanupExpiredCodexOAuthFlows();
  const flow = codexOAuthFlows.get(flowId);
  if (!flow) {
    throw new Error('Codex OAuth flow not found or expired. Start the login flow again.');
  }
  if (flow.status === 'success') {
    return {
      flow: getCodexFlowSummary(flow),
      overview: buildAuthOverview(),
    };
  }

  const tokenData = await exchangeOpenAICodexAuthorizationCode(code, flow.verifier);
  const profile = buildCodexProfileFromTokenResponse(tokenData, source, loadProfile(CODEX_PROVIDER) || {});
  saveProfile(CODEX_PROVIDER, profile);
  ensureCodexCliAuthFromStoredProfile();

  flow.status = 'success';
  flow.error = null;
  flow.updatedAt = Date.now();
  closeCodexFlowServer(flow);

  return {
    flow: getCodexFlowSummary(flow),
    overview: buildAuthOverview(),
  };
}

function startCodexOAuthCallbackServer(flow) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '/', OPENAI_CODEX_REDIRECT_URI);
        if (url.pathname !== '/auth/callback') {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(renderOauthHtml('OAuth Callback Not Found', 'The callback route was not recognized.'));
          return;
        }

        if (url.searchParams.get('state') !== flow.state) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(renderOauthHtml('OAuth State Mismatch', 'The returned OAuth state did not match the current login flow.'));
          return;
        }

        const code = url.searchParams.get('code');
        if (!code) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(renderOauthHtml('Missing Authorization Code', 'OpenAI did not return an authorization code.'));
          return;
        }

        await finalizeCodexOAuthFlow(flow.id, code, 'openai-codex-browser-oauth');
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(renderOauthHtml('OpenAI Codex Connected', 'Authentication completed. You can close this tab and return to AgentWork.'));
      } catch (err) {
        flow.error = err.message;
        flow.updatedAt = Date.now();
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(renderOauthHtml('OpenAI Codex OAuth Failed', err.message));
      }
    });

    server
      .listen(1455, '127.0.0.1', () => {
        flow.server = server;
        flow.callbackReady = true;
        flow.updatedAt = Date.now();
        resolve(flow);
      })
      .on('error', (err) => {
        flow.server = null;
        flow.callbackReady = false;
        flow.error =
          err?.code === 'EADDRINUSE'
            ? 'Port 1455 is busy. Complete sign-in, then paste the full redirect URL or authorization code below.'
            : `Could not start the local OAuth callback server: ${err.message}`;
        flow.updatedAt = Date.now();
        resolve(flow);
      });
  });
}

async function startCodexOAuthFlow() {
  const existing = getPendingCodexOAuthFlow();
  if (existing) {
    return { flow: getCodexFlowSummary(existing) };
  }

  const { verifier, challenge } = generatePkcePair();
  const state = createCodexOAuthState();
  const url = new URL(OPENAI_CODEX_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', OPENAI_CODEX_CLIENT_ID);
  url.searchParams.set('redirect_uri', OPENAI_CODEX_REDIRECT_URI);
  url.searchParams.set('scope', OPENAI_CODEX_SCOPE);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('id_token_add_organizations', 'true');
  url.searchParams.set('codex_cli_simplified_flow', 'true');
  url.searchParams.set('originator', 'pi');

  const flow = {
    id: crypto.randomBytes(16).toString('hex'),
    verifier,
    state,
    authUrl: url.toString(),
    status: 'pending',
    callbackReady: false,
    error: null,
    server: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  codexOAuthFlows.set(flow.id, flow);
  await startCodexOAuthCallbackServer(flow);

  return { flow: getCodexFlowSummary(flow) };
}

function getCodexOAuthFlowStatus(flowId) {
  cleanupExpiredCodexOAuthFlows();
  const flow = codexOAuthFlows.get(String(flowId || '').trim());
  if (!flow) {
    throw new Error('Codex OAuth flow not found or expired. Start the login flow again.');
  }
  return {
    flow: getCodexFlowSummary(flow),
    ...(flow.status === 'success' ? { overview: buildAuthOverview() } : {}),
  };
}

async function completeCodexOAuthFlow(flowId, authorizationResponse) {
  const id = String(flowId || '').trim();
  const flow = codexOAuthFlows.get(id);
  if (!flow) {
    throw new Error('Codex OAuth flow not found or expired. Start the login flow again.');
  }

  const parsed = parseAuthorizationInput(authorizationResponse);
  if (parsed.state && parsed.state !== flow.state) {
    throw new Error('Codex OAuth state mismatch. Restart the login flow and try again.');
  }
  if (!parsed.code) {
    throw new Error('Paste the full redirect URL or the authorization code from OpenAI.');
  }

  return finalizeCodexOAuthFlow(id, parsed.code, 'openai-codex-manual-oauth');
}

function ensureCodexCliAuthFromStoredProfile() {
  let profile = loadProfile(CODEX_PROVIDER);
  if (!profile?.access || !profile?.refresh) {
    const localProfile = readCodexFileCredentials();
    if (!localProfile?.access || !localProfile?.refresh) return false;
    profile = saveProfile(CODEX_PROVIDER, localProfile);
  }

  const codexHome = computeCodexHome();
  const authPath = path.join(codexHome, 'auth.json');
  const existing = readJsonObject(authPath) || {};
  const existingProfile = extractCodexProfile(existing, 'codex-auth-json');

  if (existingProfile) {
    const sameAccount =
      !profile.accountId
      || !existingProfile.accountId
      || profile.accountId === existingProfile.accountId;
    const preferExisting = sameAccount && (
      getLastRefreshMs(existingProfile.lastRefresh) > getLastRefreshMs(profile.lastRefresh)
      || (!profile.idToken && Boolean(existingProfile.idToken))
    );
    if (preferExisting) {
      profile = saveProfile(CODEX_PROVIDER, mergeCodexProfiles(profile, existingProfile));
    }
  }

  const existingTokens = existing?.tokens && typeof existing.tokens === 'object' ? existing.tokens : {};
  const profileTokens = profile?.tokens && typeof profile.tokens === 'object' ? profile.tokens : {};
  const nextTokens = {
    ...existingTokens,
    ...profileTokens,
  };
  delete nextTokens.api_key;
  delete nextTokens.OPENAI_API_KEY;
  delete nextTokens.openai_api_key;
  delete nextTokens.apiKey;

  const payload = {
    ...existing,
    tokens: {
      ...nextTokens,
      access_token: profile.access,
      refresh_token: profile.refresh,
      ...(profile.accountId ? { account_id: profile.accountId } : {}),
      ...(profile.idToken ? { id_token: profile.idToken } : {}),
    },
    last_refresh: normalizeLastRefresh(profile.lastRefresh),
  };
  delete payload.OPENAI_API_KEY;
  delete payload.api_key;
  delete payload.openai_api_key;
  delete payload.apiKey;

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
  completeCodexOAuthFlow,
  deleteProfile,
  ensureCodexCliAuthFromStoredProfile,
  getCodexOAuthFlowStatus,
  importCodexCliProfile,
  importGeminiCliProfile,
  listProfiles,
  loadProfile,
  resolveProviderRuntimeAuth,
  saveAnthropicSetupToken,
  startCodexOAuthFlow,
};
