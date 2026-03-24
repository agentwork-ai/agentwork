module.exports = {
  up(db) {
    const projectCols = db.prepare("PRAGMA table_info(projects)").all().map((column) => column.name);

    if (!projectCols.includes('project_template')) {
      db.exec("ALTER TABLE projects ADD COLUMN project_template TEXT DEFAULT 'generic'");
    }

    db.exec(`
      UPDATE projects
      SET project_template = 'generic'
      WHERE project_template IS NULL OR TRIM(project_template) = ''
    `);
  },
};
