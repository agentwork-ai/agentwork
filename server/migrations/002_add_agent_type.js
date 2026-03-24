module.exports = {
  up(db) {
    const agentCols = db.prepare("PRAGMA table_info(agents)").all().map((col) => col.name);
    if (!agentCols.includes('agent_type')) {
      db.exec("ALTER TABLE agents ADD COLUMN agent_type TEXT DEFAULT 'smart'");
    }
  },
};
