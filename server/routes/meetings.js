const express = require('express');
const router = express.Router();
const {
  MODE_DEFINITIONS,
  listMeetings,
  getMeetingDetail,
  createMeeting,
  updateMeeting,
  deleteMeeting,
  startMeeting,
  applyMeetingTasks,
} = require('../services/meetings');

router.get('/modes', (_req, res) => {
  res.json(Object.values(MODE_DEFINITIONS));
});

router.get('/', (req, res) => {
  res.json(listMeetings(req.query.project_id || ''));
});

router.post('/', (req, res) => {
  try {
    const meeting = createMeeting(req.body || {}, req.app.get('io'));
    res.status(201).json(meeting);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  const meeting = getMeetingDetail(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  res.json(meeting);
});

router.put('/:id', (req, res) => {
  try {
    const meeting = updateMeeting(req.params.id, req.body || {}, req.app.get('io'));
    res.json(meeting);
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 400).json({ error: err.message });
  }
});

router.post('/:id/start', async (req, res) => {
  try {
    const meeting = await startMeeting(req.params.id, req.app.get('io'));
    res.json(meeting);
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 400).json({ error: err.message });
  }
});

router.post('/:id/apply-tasks', (req, res) => {
  try {
    const detail = applyMeetingTasks(req.params.id, req.app.get('io'));
    res.json(detail);
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 400).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    res.json(deleteMeeting(req.params.id, req.app.get('io')));
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 400).json({ error: err.message });
  }
});

module.exports = router;
