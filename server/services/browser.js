const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../db');

const BROWSER_ROOT = path.join(DATA_DIR, 'browser');
const PROFILE_ROOT = path.join(BROWSER_ROOT, 'profiles');
const OUTPUT_ROOT = path.join(BROWSER_ROOT, 'output');
const DOWNLOAD_ROOT = path.join(BROWSER_ROOT, 'downloads');
const DEFAULT_VIEWPORT = { width: 1440, height: 960 };
const DEFAULT_SNAPSHOT_LIMIT = 120;
const DEFAULT_WAIT_TIMEOUT_MS = 15000;

const sessions = new Map();
let pageCounter = 0;

function ensureDirs() {
  fs.mkdirSync(PROFILE_ROOT, { recursive: true });
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  fs.mkdirSync(DOWNLOAD_ROOT, { recursive: true });
}

function sanitizeName(value, fallback) {
  const cleaned = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

function defaultProfileForAgent(agentId) {
  return sanitizeName(agentId ? `agent-${agentId}` : '', 'default');
}

function resolveProfile(agentId, requestedProfile) {
  return sanitizeName(requestedProfile, defaultProfileForAgent(agentId));
}

function getProfileDir(profile) {
  ensureDirs();
  return path.join(PROFILE_ROOT, profile);
}

function getOutputDir(profile) {
  ensureDirs();
  const dir = path.join(OUTPUT_ROOT, profile);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getDownloadDir(profile) {
  ensureDirs();
  const dir = path.join(DOWNLOAD_ROOT, profile);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getDefaultHeadless() {
  return process.env.AGENTWORK_BROWSER_HEADLESS !== 'false';
}

function getPlaywright() {
  try {
    return require('playwright');
  } catch (err) {
    throw new Error(
      'Browser control requires Playwright. Install it with `npm install playwright --legacy-peer-deps` and then run `npx playwright install chromium`.'
    );
  }
}

function clampTimeout(value, fallback = DEFAULT_WAIT_TIMEOUT_MS) {
  const parsed = parseInt(String(value || fallback), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 120000);
}

function nextPageId() {
  pageCounter += 1;
  return `tab-${pageCounter}`;
}

function ensurePageId(page) {
  if (!page.__agentworkPageId) {
    page.__agentworkPageId = nextPageId();
  }
  return page.__agentworkPageId;
}

function getSessionPages(session) {
  return session.context.pages().filter((page) => !page.isClosed());
}

function findPageIndex(session, input = {}) {
  const pages = getSessionPages(session);
  if (pages.length === 0) return -1;

  if (input.tabId) {
    const idx = pages.findIndex((page) => ensurePageId(page) === input.tabId);
    if (idx >= 0) return idx;
  }

  if (input.tabIndex !== undefined && input.tabIndex !== null) {
    const idx = parseInt(String(input.tabIndex), 10);
    if (Number.isFinite(idx) && idx >= 0 && idx < pages.length) return idx;
  }

  if (typeof session.currentPageId === 'string') {
    const idx = pages.findIndex((page) => ensurePageId(page) === session.currentPageId);
    if (idx >= 0) return idx;
  }

  return 0;
}

async function getCurrentPage(session, input = {}) {
  let pages = getSessionPages(session);
  if (pages.length === 0) {
    const page = await session.context.newPage();
    ensurePageId(page);
    session.currentPageId = ensurePageId(page);
    return page;
  }

  const idx = findPageIndex(session, input);
  const page = pages[Math.max(0, idx)];
  ensurePageId(page);
  session.currentPageId = ensurePageId(page);
  return page;
}

async function serializePages(session) {
  const pages = getSessionPages(session);
  const current = await getCurrentPage(session);
  return Promise.all(
    pages.map(async (page, index) => ({
      id: ensurePageId(page),
      index,
      title: await page.title().catch(() => ''),
      url: page.url(),
      current: ensurePageId(page) === ensurePageId(current),
    }))
  );
}

async function ensureSession(agentId, options = {}) {
  const profile = resolveProfile(agentId, options.profile);
  let session = sessions.get(profile);
  if (session?.context) {
    return session;
  }

  const { chromium } = getPlaywright();
  const headless = options.headless !== undefined ? Boolean(options.headless) : getDefaultHeadless();
  const context = await chromium.launchPersistentContext(getProfileDir(profile), {
    headless,
    acceptDownloads: true,
    viewport: DEFAULT_VIEWPORT,
    downloadsPath: getDownloadDir(profile),
  });

  session = {
    profile,
    context,
    headless,
    currentPageId: null,
    startedAt: new Date().toISOString(),
  };

  context.on('page', async (page) => {
    ensurePageId(page);
    session.currentPageId = ensurePageId(page);
    page.on('close', () => {
      const pages = getSessionPages(session);
      if (pages.length === 0) {
        session.currentPageId = null;
      } else if (!pages.some((item) => ensurePageId(item) === session.currentPageId)) {
        session.currentPageId = ensurePageId(pages[0]);
      }
    });
  });

  sessions.set(profile, session);
  await getCurrentPage(session);
  return session;
}

async function stopSession(profile) {
  const session = sessions.get(profile);
  if (!session) return false;
  try {
    await session.context.close();
  } finally {
    sessions.delete(profile);
  }
  return true;
}

function buildSnapshotText(snapshot) {
  const lines = [
    `Title: ${snapshot.title || '(untitled)'}`,
    `URL: ${snapshot.url || '(unknown)'}`,
  ];

  if (snapshot.headings.length > 0) {
    lines.push('', 'Headings:');
    for (const heading of snapshot.headings) {
      lines.push(`- ${heading.level}: ${heading.text}`);
    }
  }

  lines.push('', 'Interactive elements:');
  if (snapshot.interactive.length === 0) {
    lines.push('(none found)');
  } else {
    for (const element of snapshot.interactive) {
      const details = [
        element.role || element.tag,
        element.text ? `text="${element.text}"` : '',
        element.label ? `label="${element.label}"` : '',
        element.placeholder ? `placeholder="${element.placeholder}"` : '',
        element.value ? `value="${element.value}"` : '',
        element.href ? `href="${element.href}"` : '',
      ].filter(Boolean);
      lines.push(`[${element.ref}] ${details.join(' | ')}`);
    }
  }

  return lines.join('\n');
}

async function createSnapshot(page, options = {}) {
  const limit = Math.max(1, Math.min(parseInt(String(options.limit || DEFAULT_SNAPSHOT_LIMIT), 10) || DEFAULT_SNAPSHOT_LIMIT, 200));
  const snapshot = await page.evaluate(({ limit }) => {
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      if (!style || style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const textOf = (element) => (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
    const attr = (element, name) => (element.getAttribute(name) || '').trim();

    const labelOf = (element) => {
      const ariaLabel = attr(element, 'aria-label');
      if (ariaLabel) return ariaLabel;

      const labelledBy = attr(element, 'aria-labelledby');
      if (labelledBy) {
        const text = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id))
          .filter(Boolean)
          .map((node) => textOf(node))
          .join(' ')
          .trim();
        if (text) return text;
      }

      if (element.labels && element.labels.length > 0) {
        const labelText = Array.from(element.labels).map((node) => textOf(node)).join(' ').trim();
        if (labelText) return labelText;
      }

      const closestLabel = element.closest('label');
      if (closestLabel) {
        const labelText = textOf(closestLabel);
        if (labelText) return labelText;
      }

      return '';
    };

    const roleOf = (element) => {
      const explicit = attr(element, 'role');
      if (explicit) return explicit;
      const tag = element.tagName.toLowerCase();
      if (tag === 'a') return 'link';
      if (tag === 'button') return 'button';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'select') return 'listbox';
      if (tag === 'option') return 'option';
      if (tag === 'summary') return 'button';
      if (tag === 'input') {
        const type = (attr(element, 'type') || 'text').toLowerCase();
        if (['button', 'submit', 'reset'].includes(type)) return 'button';
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        return 'textbox';
      }
      if (element.isContentEditable) return 'textbox';
      return tag;
    };

    document.querySelectorAll('[data-agentwork-ref]').forEach((element) => {
      element.removeAttribute('data-agentwork-ref');
    });

    const headingNodes = Array.from(document.querySelectorAll('h1, h2, h3, h4, [role="heading"]'))
      .filter(visible)
      .slice(0, 20)
      .map((element) => ({
        level: element.tagName.toUpperCase(),
        text: textOf(element).slice(0, 160),
      }))
      .filter((item) => item.text);

    const selectors = [
      'a',
      'button',
      'input',
      'textarea',
      'select',
      'option',
      'summary',
      '[role="button"]',
      '[role="link"]',
      '[role="textbox"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="tab"]',
      '[role="menuitem"]',
      '[role="option"]',
      '[contenteditable="true"]',
    ].join(',');

    const seen = new Set();
    const interactive = [];
    let refCounter = 1;
    for (const element of Array.from(document.querySelectorAll(selectors))) {
      if (!visible(element)) continue;
      if (seen.has(element)) continue;
      seen.add(element);

      const ref = String(refCounter++);
      element.setAttribute('data-agentwork-ref', ref);

      interactive.push({
        ref,
        tag: element.tagName.toLowerCase(),
        role: roleOf(element),
        text: textOf(element).slice(0, 160),
        label: labelOf(element).slice(0, 160),
        placeholder: attr(element, 'placeholder').slice(0, 120),
        value: ('value' in element ? String(element.value || '') : '').slice(0, 120),
        href: attr(element, 'href').slice(0, 200),
      });

      if (interactive.length >= limit) break;
    }

    return {
      title: document.title,
      url: window.location.href,
      headings: headingNodes,
      interactive,
    };
  }, { limit });

  return {
    ...snapshot,
    text: buildSnapshotText(snapshot),
  };
}

function getLocator(page, input) {
  if (input.ref) {
    return page.locator(`[data-agentwork-ref="${String(input.ref)}"]`).first();
  }

  if (input.selector) {
    return page.locator(String(input.selector)).first();
  }

  throw new Error('This browser action requires `ref` from `browser snapshot`.');
}

function resolveOutputPath(profile, requestedPath, extension) {
  if (requestedPath) {
    const fullPath = path.isAbsolute(requestedPath)
      ? requestedPath
      : path.resolve(requestedPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    return fullPath;
  }

  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  return path.join(getOutputDir(profile), fileName);
}

async function browserStatus(agentId, input = {}) {
  const profile = resolveProfile(agentId, input.profile);
  const session = sessions.get(profile);
  if (!session) {
    return {
      profile,
      running: false,
    };
  }

  const page = await getCurrentPage(session);
  return {
    profile,
    running: true,
    headless: session.headless,
    startedAt: session.startedAt,
    currentTabId: ensurePageId(page),
    title: await page.title().catch(() => ''),
    url: page.url(),
    tabs: await serializePages(session),
  };
}

async function browserTabs(session) {
  return {
    profile: session.profile,
    currentTabId: session.currentPageId,
    tabs: await serializePages(session),
  };
}

async function browserOpen(agentId, input = {}) {
  const session = await ensureSession(agentId, input);
  const page = await session.context.newPage();
  ensurePageId(page);
  session.currentPageId = ensurePageId(page);
  if (input.url) {
    await page.goto(String(input.url), { waitUntil: 'domcontentloaded', timeout: clampTimeout(input.timeoutMs) });
  }
  return {
    profile: session.profile,
    currentTabId: ensurePageId(page),
    title: await page.title().catch(() => ''),
    url: page.url(),
    tabs: await serializePages(session),
  };
}

async function browserNavigate(agentId, input = {}) {
  if (!input.url) throw new Error('`url` is required for browser navigate.');
  const session = await ensureSession(agentId, input);
  const page = await getCurrentPage(session, input);
  await page.goto(String(input.url), { waitUntil: 'domcontentloaded', timeout: clampTimeout(input.timeoutMs) });
  return {
    profile: session.profile,
    currentTabId: ensurePageId(page),
    title: await page.title().catch(() => ''),
    url: page.url(),
  };
}

async function browserFocus(agentId, input = {}) {
  const session = await ensureSession(agentId, input);
  const page = await getCurrentPage(session, input);
  await page.bringToFront().catch(() => {});
  return {
    profile: session.profile,
    currentTabId: ensurePageId(page),
    title: await page.title().catch(() => ''),
    url: page.url(),
    tabs: await serializePages(session),
  };
}

async function browserClose(agentId, input = {}) {
  const session = await ensureSession(agentId, input);
  const page = await getCurrentPage(session, input);
  const closingId = ensurePageId(page);
  await page.close();
  const pages = getSessionPages(session);
  if (pages.length > 0) {
    session.currentPageId = ensurePageId(pages[0]);
  } else {
    session.currentPageId = null;
  }
  return {
    profile: session.profile,
    closedTabId: closingId,
    tabs: await serializePages(session),
  };
}

async function browserSnapshot(agentId, input = {}) {
  const session = await ensureSession(agentId, input);
  const page = await getCurrentPage(session, input);
  const snapshot = await createSnapshot(page, input);

  if (String(input.format || 'text').toLowerCase() === 'json') {
    return {
      profile: session.profile,
      tabId: ensurePageId(page),
      title: snapshot.title,
      url: snapshot.url,
      headings: snapshot.headings,
      refs: snapshot.interactive,
      stats: {
        refs: snapshot.interactive.length,
        headings: snapshot.headings.length,
      },
    };
  }

  return snapshot.text;
}

async function browserScreenshot(agentId, input = {}) {
  const session = await ensureSession(agentId, input);
  const page = await getCurrentPage(session, input);
  const outputPath = resolveOutputPath(session.profile, input.path, 'png');

  if (input.ref || input.selector) {
    const locator = getLocator(page, input);
    await locator.screenshot({ path: outputPath });
  } else {
    await page.screenshot({ path: outputPath, fullPage: Boolean(input.fullPage) });
  }

  return {
    profile: session.profile,
    tabId: ensurePageId(page),
    path: outputPath,
  };
}

async function browserWait(agentId, input = {}) {
  const session = await ensureSession(agentId, input);
  const page = await getCurrentPage(session, input);
  const timeout = clampTimeout(input.timeoutMs);

  if (input.url) {
    await page.waitForURL(String(input.url), { timeout });
  }
  if (input.loadState) {
    await page.waitForLoadState(String(input.loadState), { timeout });
  }
  if (input.text) {
    await page.getByText(String(input.text), { exact: false }).first().waitFor({ state: 'visible', timeout });
  }
  if (input.selector) {
    await page.locator(String(input.selector)).first().waitFor({ state: 'visible', timeout });
  }
  if (input.ref) {
    await getLocator(page, input).waitFor({ state: 'visible', timeout });
  }

  return {
    profile: session.profile,
    tabId: ensurePageId(page),
    title: await page.title().catch(() => ''),
    url: page.url(),
  };
}

async function browserAct(agentId, input = {}) {
  const session = await ensureSession(agentId, input);
  const page = await getCurrentPage(session, input);
  const kind = String(input.kind || '').trim().toLowerCase();
  if (!kind) throw new Error('`kind` is required for browser act.');

  const timeout = clampTimeout(input.timeoutMs);
  const locator = ['press'].includes(kind) && !input.ref && !input.selector
    ? null
    : getLocator(page, input);

  if (locator) {
    await locator.waitFor({ state: 'visible', timeout });
    await locator.scrollIntoViewIfNeeded().catch(() => {});
  }

  switch (kind) {
    case 'click':
      await locator.click({ timeout });
      break;
    case 'double_click':
    case 'double-click':
      await locator.dblclick({ timeout });
      break;
    case 'hover':
      await locator.hover({ timeout });
      break;
    case 'type':
      if (input.text === undefined) throw new Error('`text` is required for browser act kind=type.');
      await locator.click({ timeout });
      await locator.press('Meta+A').catch(() => {});
      await locator.press('Control+A').catch(() => {});
      await locator.type(String(input.text), { timeout });
      break;
    case 'fill':
      if (input.text === undefined) throw new Error('`text` is required for browser act kind=fill.');
      await locator.fill(String(input.text), { timeout });
      break;
    case 'press':
      if (!input.key) throw new Error('`key` is required for browser act kind=press.');
      if (locator) {
        await locator.press(String(input.key), { timeout });
      } else {
        await page.keyboard.press(String(input.key));
      }
      break;
    case 'select': {
      const values = Array.isArray(input.values)
        ? input.values.map((value) => String(value))
        : [String(input.value || '')].filter(Boolean);
      if (values.length === 0) throw new Error('`value` or `values` is required for browser act kind=select.');
      await locator.selectOption(values);
      break;
    }
    case 'check':
      await locator.check({ timeout });
      break;
    case 'uncheck':
      await locator.uncheck({ timeout });
      break;
    case 'scroll_into_view':
    case 'scrollintoview':
      await locator.scrollIntoViewIfNeeded();
      break;
    case 'drag':
      if (!input.toRef) throw new Error('`toRef` is required for browser act kind=drag.');
      await locator.dragTo(page.locator(`[data-agentwork-ref="${String(input.toRef)}"]`).first());
      break;
    default:
      throw new Error(`Unsupported browser act kind: ${kind}`);
  }

  return {
    profile: session.profile,
    tabId: ensurePageId(page),
    kind,
    title: await page.title().catch(() => ''),
    url: page.url(),
  };
}

async function runBrowserTool(agentId, input = {}) {
  const action = String(input.action || 'status').trim().toLowerCase();

  switch (action) {
    case 'status':
      return JSON.stringify(await browserStatus(agentId, input), null, 2);
    case 'start':
      await ensureSession(agentId, input);
      return JSON.stringify(await browserStatus(agentId, input), null, 2);
    case 'stop': {
      const profile = resolveProfile(agentId, input.profile);
      const stopped = await stopSession(profile);
      return JSON.stringify({ profile, stopped }, null, 2);
    }
    case 'tabs': {
      const session = await ensureSession(agentId, input);
      return JSON.stringify(await browserTabs(session), null, 2);
    }
    case 'open':
      return JSON.stringify(await browserOpen(agentId, input), null, 2);
    case 'focus':
      return JSON.stringify(await browserFocus(agentId, input), null, 2);
    case 'close':
      return JSON.stringify(await browserClose(agentId, input), null, 2);
    case 'navigate':
      return JSON.stringify(await browserNavigate(agentId, input), null, 2);
    case 'snapshot': {
      const result = await browserSnapshot(agentId, input);
      return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    }
    case 'screenshot':
      return JSON.stringify(await browserScreenshot(agentId, input), null, 2);
    case 'wait':
      return JSON.stringify(await browserWait(agentId, input), null, 2);
    case 'act':
      return JSON.stringify(await browserAct(agentId, input), null, 2);
    default:
      throw new Error(`Unsupported browser action: ${action}`);
  }
}

module.exports = {
  runBrowserTool,
};
