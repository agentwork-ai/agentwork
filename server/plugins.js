const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./db');

const PLUGINS_DIR = path.join(DATA_DIR, 'plugins');

// Registry of loaded plugins by type
const loadedPlugins = [];
const pluginTools = [];
const pluginHooks = new Map(); // event -> [handler, ...]

/**
 * Scan ~/.agentwork/plugins/ for plugin folders.
 * Each plugin folder must contain a plugin.json manifest and an index.js entry point.
 *
 * Manifest format:
 *   { name, version, description, type: "tool"|"platform"|"hook" }
 *
 * For "tool" plugins, index.js exports:
 *   { name, description, parameters, handler(input, workDir) }
 *
 * For "hook" plugins, index.js exports:
 *   { event, handler(data) }
 */
function loadPlugins() {
  // Clear previous state
  loadedPlugins.length = 0;
  pluginTools.length = 0;
  pluginHooks.clear();

  if (!fs.existsSync(PLUGINS_DIR)) {
    console.log('[Plugins] No plugins directory found, skipping.');
    return;
  }

  let entries;
  try {
    entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });
  } catch (err) {
    console.error('[Plugins] Failed to read plugins directory:', err.message);
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const pluginDir = path.join(PLUGINS_DIR, entry.name);
    const manifestPath = path.join(pluginDir, 'plugin.json');
    const entryPath = path.join(pluginDir, 'index.js');

    // Validate manifest exists
    if (!fs.existsSync(manifestPath)) {
      console.warn(`[Plugins] Skipping "${entry.name}": missing plugin.json`);
      continue;
    }

    // Load manifest
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      console.error(`[Plugins] Skipping "${entry.name}": invalid plugin.json — ${err.message}`);
      continue;
    }

    // Validate required manifest fields
    if (!manifest.name || !manifest.version || !manifest.type) {
      console.warn(`[Plugins] Skipping "${entry.name}": plugin.json must have name, version, and type`);
      continue;
    }

    const validTypes = ['tool', 'platform', 'hook'];
    if (!validTypes.includes(manifest.type)) {
      console.warn(`[Plugins] Skipping "${entry.name}": unknown type "${manifest.type}" (expected: ${validTypes.join(', ')})`);
      continue;
    }

    // Validate entry point exists
    if (!fs.existsSync(entryPath)) {
      console.warn(`[Plugins] Skipping "${entry.name}": missing index.js`);
      continue;
    }

    // Load plugin module
    let pluginModule;
    try {
      // Clear require cache to pick up changes on reload
      delete require.cache[require.resolve(entryPath)];
      pluginModule = require(entryPath);
    } catch (err) {
      console.error(`[Plugins] Failed to load "${entry.name}": ${err.message}`);
      continue;
    }

    // Register based on type
    const pluginInfo = {
      ...manifest,
      directory: pluginDir,
      enabled: true,
    };

    switch (manifest.type) {
      case 'tool': {
        if (!pluginModule.name || !pluginModule.handler) {
          console.warn(`[Plugins] Tool plugin "${entry.name}" must export { name, description, parameters, handler }`);
          continue;
        }
        pluginTools.push({
          name: pluginModule.name,
          description: pluginModule.description || manifest.description || '',
          parameters: pluginModule.parameters || {
            type: 'object',
            properties: { input: { type: 'string', description: 'Input for the plugin tool' } },
            required: ['input'],
          },
          _plugin: true,
          _pluginName: manifest.name,
          _handler: pluginModule.handler,
        });
        break;
      }

      case 'hook': {
        if (!pluginModule.event || !pluginModule.handler) {
          console.warn(`[Plugins] Hook plugin "${entry.name}" must export { event, handler }`);
          continue;
        }
        const handlers = pluginHooks.get(pluginModule.event) || [];
        handlers.push(pluginModule.handler);
        pluginHooks.set(pluginModule.event, handlers);
        break;
      }

      case 'platform': {
        // Platform plugins are registered but not actively loaded here.
        // They can be consumed by other services that need platform integrations.
        break;
      }
    }

    loadedPlugins.push(pluginInfo);
    console.log(`[Plugins] Loaded: ${manifest.name} v${manifest.version} (${manifest.type})`);
  }

  console.log(`[Plugins] ${loadedPlugins.length} plugin(s) loaded — ${pluginTools.length} tool(s), ${pluginHooks.size} hook event(s)`);
}

/**
 * Get plugin tool definitions (same format as AGENT_TOOLS).
 * Each tool includes a _handler function for execution.
 */
function getPluginTools() {
  return pluginTools;
}

/**
 * Get all loaded plugin manifests.
 */
function getPlugins() {
  return loadedPlugins;
}

/**
 * Fire hook handlers for a given event.
 * Returns an array of results from all handlers.
 */
async function fireHook(event, data) {
  const handlers = pluginHooks.get(event);
  if (!handlers || handlers.length === 0) return [];

  const results = [];
  for (const handler of handlers) {
    try {
      const result = await handler(data);
      results.push(result);
    } catch (err) {
      console.error(`[Plugins] Hook handler error for event "${event}":`, err.message);
    }
  }
  return results;
}

module.exports = { loadPlugins, getPluginTools, getPlugins, fireHook, PLUGINS_DIR };
