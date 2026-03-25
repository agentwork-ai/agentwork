function up(db) {
  const columns = db.prepare("PRAGMA table_info(agents)").all().map((column) => column.name);
  if (!columns.includes('skills_json')) {
    db.exec("ALTER TABLE agents ADD COLUMN skills_json TEXT DEFAULT '[]'");
  }
}

module.exports = { up };
