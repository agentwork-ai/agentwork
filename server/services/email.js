/**
 * Email Notification Service
 * Sends email via SMTP using Node's built-in capabilities (no npm package needed).
 * Configure via settings: smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from
 */
const { db } = require('../db');
const { decrypt, isSensitiveKey } = require('../crypto');
const net = require('net');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return '';
  return isSensitiveKey(key) ? decrypt(row.value) : row.value;
}

/**
 * Send a simple email using raw SMTP (no dependencies).
 * For production use, consider adding nodemailer.
 */
async function sendEmail(to, subject, body) {
  const host = getSetting('smtp_host');
  const port = parseInt(getSetting('smtp_port') || '587');
  const user = getSetting('smtp_user');
  const pass = getSetting('smtp_pass');
  const from = getSetting('smtp_from') || user;

  if (!host || !user) {
    console.warn('[Email] SMTP not configured. Set smtp_host, smtp_user, smtp_pass in settings.');
    return false;
  }

  // Use a simple SMTP client approach
  return new Promise((resolve) => {
    try {
      const socket = net.createConnection(port, host);
      const commands = [
        `EHLO agentwork`,
        `AUTH LOGIN`,
        Buffer.from(user).toString('base64'),
        Buffer.from(pass).toString('base64'),
        `MAIL FROM:<${from}>`,
        `RCPT TO:<${to}>`,
        `DATA`,
        `From: AgentWork <${from}>\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n.`,
        `QUIT`,
      ];
      let cmdIdx = 0;

      socket.setEncoding('utf8');
      socket.on('data', () => {
        if (cmdIdx < commands.length) {
          socket.write(commands[cmdIdx] + '\r\n');
          cmdIdx++;
        }
      });
      socket.on('end', () => resolve(true));
      socket.on('error', (err) => {
        console.error(`[Email] SMTP error: ${err.message}`);
        resolve(false);
      });
      socket.setTimeout(10000, () => { socket.destroy(); resolve(false); });
    } catch (err) {
      console.error(`[Email] Failed: ${err.message}`);
      resolve(false);
    }
  });
}

/**
 * Send a task notification email.
 */
async function notifyTaskComplete(task, agentName) {
  const recipient = getSetting('notification_email');
  if (!recipient) return;
  await sendEmail(
    recipient,
    `[AgentWork] Task completed: ${task.title}`,
    `Agent ${agentName} completed the task "${task.title}".\n\nOutput:\n${task.completion_output || '(no output)'}\n\nView at: http://localhost:${process.env.PORT || 1248}/kanban`
  );
}

async function notifyTaskBlocked(task, agentName, reason) {
  const recipient = getSetting('notification_email');
  if (!recipient) return;
  await sendEmail(
    recipient,
    `[AgentWork] Task blocked: ${task.title}`,
    `Agent ${agentName} is blocked on "${task.title}".\n\nReason: ${reason}\n\nView at: http://localhost:${process.env.PORT || 1248}/kanban`
  );
}

module.exports = { sendEmail, notifyTaskComplete, notifyTaskBlocked };
