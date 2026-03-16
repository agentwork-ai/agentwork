/**
 * Simple AES-256-GCM encryption for API keys at rest.
 * Uses a machine-specific key derived from hostname + data directory path.
 */
const crypto = require('crypto');
const os = require('os');
const path = require('path');

const DATA_DIR = process.env.AGENTWORK_DATA || path.join(os.homedir(), '.agentwork');

// Derive a stable encryption key from machine-specific data
function deriveKey() {
  const material = `agentwork:${os.hostname()}:${DATA_DIR}:${os.userInfo().username}`;
  return crypto.createHash('sha256').update(material).digest();
}

const ENCRYPTION_PREFIX = 'enc:';

function encrypt(plaintext) {
  if (!plaintext || plaintext.startsWith(ENCRYPTION_PREFIX)) return plaintext;
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${ENCRYPTION_PREFIX}${iv.toString('hex')}:${tag}:${encrypted}`;
}

function decrypt(ciphertext) {
  if (!ciphertext || !ciphertext.startsWith(ENCRYPTION_PREFIX)) return ciphertext;
  try {
    const data = ciphertext.slice(ENCRYPTION_PREFIX.length);
    const [ivHex, tagHex, encrypted] = data.split(':');
    const key = deriveKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return ciphertext; // Return as-is if decryption fails (e.g., migrated data)
  }
}

// Keys that should be encrypted
const SENSITIVE_KEYS = [
  'anthropic_api_key', 'openai_api_key', 'openrouter_api_key',
  'deepseek_api_key', 'mistral_api_key', 'dashboard_password',
];

function isSensitiveKey(key) {
  return SENSITIVE_KEYS.includes(key);
}

module.exports = { encrypt, decrypt, isSensitiveKey, SENSITIVE_KEYS };
