const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// Read a file's content
router.get('/read', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Path is required' });

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

module.exports = router;
