const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { db } = require('../db');

// Check if a file path is within a registered project directory
function isPathAllowed(filePath) {
  const resolved = path.resolve(filePath);
  const projects = db.prepare('SELECT path FROM projects').all();
  return projects.some((p) => resolved.startsWith(path.resolve(p.path)));
}

// Read a file's content
router.get('/read', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Path is required' });

  if (!isPathAllowed(filePath)) {
    return res.status(403).json({ error: 'Access denied: file is outside registered project directories' });
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 1024 * 1024) {
      return res.status(400).json({ error: 'File too large (>1MB)' });
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const ext = path.extname(filePath).slice(1);
    res.json({ content, extension: ext, size: stat.size });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Open native OS folder picker dialog
router.get('/browse-folder', (req, res) => {
  const platform = process.platform;
  try {
    let folderPath;
    if (platform === 'darwin') {
      folderPath = execSync(
        `osascript -e 'POSIX path of (choose folder with prompt "Select project folder")'`,
        { encoding: 'utf8', timeout: 60000 }
      ).trim();
    } else if (platform === 'linux') {
      // Try zenity first, then kdialog
      try {
        folderPath = execSync('zenity --file-selection --directory --title="Select project folder"', { encoding: 'utf8', timeout: 60000 }).trim();
      } catch {
        folderPath = execSync('kdialog --getexistingdirectory "$HOME"', { encoding: 'utf8', timeout: 60000 }).trim();
      }
    } else {
      return res.status(400).json({ error: 'Folder picker not supported on this platform' });
    }
    res.json({ path: folderPath });
  } catch (err) {
    // User cancelled the dialog (exit code 1 on macOS)
    if (err.status === 1 || (err.stderr || '').includes('User canceled')) {
      return res.json({ path: null, cancelled: true });
    }
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
