const express = require('express');

function createGridRouter(smartGridTracker) {
  const router = express.Router();

  // GET /api/grid-bots
  router.get('/', (req, res) => {
    res.json(smartGridTracker.grids);
  });

  // GET /api/grid-bots/logs
  router.get('/logs', (req, res) => {
    res.json(smartGridTracker.logs);
  });

  // POST /api/grid-bots
  router.post('/', async (req, res) => {
    try {
      const gridBot = await smartGridTracker.createGridBot(req.body);
      res.status(201).json(gridBot);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // POST /api/grid-bots/:id/pause
  router.post('/:id/pause', async (req, res) => {
    try {
      const gridBot = await smartGridTracker.pauseGridBot(req.params.id);
      res.json(gridBot);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // POST /api/grid-bots/:id/resume
  router.post('/:id/resume', async (req, res) => {
    try {
      const gridBot = await smartGridTracker.resumeGridBot(req.params.id);
      res.json(gridBot);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // DELETE /api/grid-bots/:id
  router.delete('/:id', async (req, res) => {
    try {
      await smartGridTracker.deleteGridBot(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}

module.exports = createGridRouter;
