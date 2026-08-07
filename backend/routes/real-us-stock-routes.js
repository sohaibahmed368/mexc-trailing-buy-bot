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

  // GET /api/real-us-stocks/account (Alpaca Portfolio & Live Positions)
  router.get('/account', async (req, res) => {
    try {
      const accountData = await realUsStockTracker.getAlpacaAccountSummary();
      res.json({ success: true, data: accountData });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/real-us-stocks/cards (Launch New Real US Stock Card)
  router.post('/cards', async (req, res) => {
    try {
      const card = await realUsStockTracker.createCard(req.body);
      res.json({ success: true, card });
    } catch (e) {
      res.status(400).json({ success: false, error: e.message });
    }
  });

  // DELETE /api/real-us-stocks/cards/:id (Cancel Real US Stock Card)
  router.delete('/cards/:id', async (req, res) => {
    try {
      const ok = await realUsStockTracker.cancelCard(req.params.id);
      res.json({ success: ok });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
}

module.exports = createRealUsStockRouter;
