const express = require('express');

function createRealUsStockRouter(realUsStockTracker) {
  const router = express.Router();

  // GET /api/real-us-stocks/live
  router.get('/live', (req, res) => {
    try {
      const data = realUsStockTracker.getLiveCache();
      res.json({ success: true, data });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
}

module.exports = createRealUsStockRouter;
