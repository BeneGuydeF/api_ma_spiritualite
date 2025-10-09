// routes/evangile.js
const express = require('express');
const router = express.Router();
const AELFService = require('../services/aelf.service');

router.get('/', async (req, res) => {
  const rawDate = typeof req.query.date === 'string' ? req.query.date.trim() : '';
  const rawZone = typeof req.query.zone === 'string' ? req.query.zone.trim() : '';

  const requestedDate = rawDate || null;
  const requestedZone = rawZone || null;

  if (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    return res.status(400).json({ error: 'Format de date invalide (YYYY-MM-DD attendu)' });
  }

  try {
    // 🔧 Récupère directement l'évangile complet du jour
    const gospel = await AELFService.getTodayGospel();

    if (gospel) {
      res.set('X-MSP-Route', 'routes/evangile.js:getTodayGospel');
      return res.json({ evangile: gospel });
    }

    throw new Error('Evangile indisponible');
  } catch (error) {
    console.error('[/api/evangile] error:', error?.message || error);

    return res.status(503).json({
      error: 'Impossible de récupérer les textes liturgiques du jour.'
    });
  }
});

module.exports = router;
