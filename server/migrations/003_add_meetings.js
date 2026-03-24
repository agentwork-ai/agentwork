module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        goal TEXT DEFAULT '',
        status TEXT DEFAULT 'draft',
        mode TEXT DEFAULT 'working',
        agent_ids TEXT DEFAULT '[]',
        facilitator_agent_id TEXT DEFAULT NULL,
        auto_apply_tasks INTEGER DEFAULT 0,
        tasks_applied INTEGER DEFAULT 0,
        summary TEXT DEFAULT '',
        final_report TEXT DEFAULT '',
        error_message TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        started_at DATETIME DEFAULT NULL,
        completed_at DATETIME DEFAULT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (facilitator_agent_id) REFERENCES agents(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS meeting_messages (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL,
        speaker_type TEXT NOT NULL,
        speaker_id TEXT DEFAULT NULL,
        speaker_name TEXT DEFAULT '',
        content TEXT NOT NULL,
        round_index INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
        FOREIGN KEY (speaker_id) REFERENCES agents(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS meeting_tasks (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        priority TEXT DEFAULT 'medium',
        owner_hint TEXT DEFAULT '',
        rationale TEXT DEFAULT '',
        suggested_agent_id TEXT DEFAULT NULL,
        created_task_id TEXT DEFAULT NULL,
        status TEXT DEFAULT 'pending',
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
        FOREIGN KEY (suggested_agent_id) REFERENCES agents(id) ON DELETE SET NULL,
        FOREIGN KEY (created_task_id) REFERENCES tasks(id) ON DELETE SET NULL
      );
    `);
  },
};
