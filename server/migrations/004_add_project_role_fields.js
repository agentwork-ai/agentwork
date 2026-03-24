module.exports = {
  up(db) {
    const projectCols = db.prepare("PRAGMA table_info(projects)").all().map((column) => column.name);

    if (!projectCols.includes('project_manager_agent_id')) {
      db.exec("ALTER TABLE projects ADD COLUMN project_manager_agent_id TEXT DEFAULT NULL");
    }

    if (!projectCols.includes('main_developer_agent_id')) {
      db.exec("ALTER TABLE projects ADD COLUMN main_developer_agent_id TEXT DEFAULT NULL");
    }

    if (projectCols.includes('default_agent_id')) {
      db.exec(`
        UPDATE projects
        SET project_manager_agent_id = COALESCE(project_manager_agent_id, default_agent_id)
        WHERE default_agent_id IS NOT NULL
      `);
    }
  },
};
