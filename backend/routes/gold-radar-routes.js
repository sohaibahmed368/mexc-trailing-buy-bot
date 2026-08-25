const express = require('express');

function createGoldRadarRouter(goldRadar) {
  const router = express.Router();

  // Get full metrics across all 25 venues
  router.get('/metrics', async (req, res) => {
    try {
      let metrics = goldRadar.getMetrics();
      if (!metrics) {
        metrics = await goldRadar.refreshGoldMetrics();
      }
      res.json({
        success: true,
        data: metrics
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Get live aggregated Level-2 Gold Order Book Ladder
  router.get('/orderbook', async (req, res) => {
    try {
      let orderBook = goldRadar.getOrderBook();
      if (!orderBook) {
        await goldRadar.refreshGoldMetrics();
        orderBook = goldRadar.getOrderBook();
      }
      res.json({
        success: true,
        data: orderBook
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
}

module.exports = createGoldRadarRouter;
