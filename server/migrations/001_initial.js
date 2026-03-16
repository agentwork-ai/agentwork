/**
 * Migration 001: Initial migration marker
 * All tables up to this point were created via ad-hoc ALTER TABLE statements.
 * This migration just marks the schema as initialized.
 */
module.exports = {
  up(db) {
    // No-op: all existing tables are already created in db.js
    // Future migrations should go in numbered files: 002_add_feature.js, etc.
  },
};
