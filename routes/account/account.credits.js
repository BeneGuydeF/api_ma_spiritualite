const express = require('express');
const router = express.Router();

// chemins corrects depuis routes/account/
const db = require('../../db/sqlite');
const { requireAuth } = require('../../middleware/auth');

// Vérifie si la table existe
const exists = (t) =>
  !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);

const selCredits = db.prepare('SELECT credits FROM users WHERE id = ?');

const selHistory = exists('credit_transactions')
  ? db.prepare(`
      SELECT created_at AS date,
             type,
             amount,
             provider,
             payment_id AS paymentId,
             description
      FROM credit_transactions
      WHERE user_id=?
      ORDER BY created_at DESC
    `)
  : null;

// ========================================
// GET /api/account/credits/status
// ========================================
router.get('/credits/status', requireAuth, (req, res) => {
  const uid = Number(req.user?.id);
  if (!Number.isFinite(uid)) return res.status(401).json({ error: 'unauthorized' });

  const row = selCredits.get(uid);
  if (!row) return res.status(404).json({ error: 'introuvable' });

  const credits = Number(row.credits) || 0;
  res.json({ credits, locked: credits <= 0 });
});

// ========================================
// GET /api/account/payments/history
// ========================================
router.get('/payments/history', requireAuth, (req, res) => {
  const uid = Number(req.user?.id);
  if (!Number.isFinite(uid)) return res.status(401).json({ error: 'unauthorized' });

  if (!selHistory) {
    return res.json({ items: [], note: 'history_unavailable' });
  }

  res.json({ items: selHistory.all(uid) });
});

// ========================================
// POST /api/account/donations/create
// ========================================
router.post('/donations/create', requireAuth, (req, res) => {
  const amt = Number(req.body?.amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: 'montant invalide' });
  }

  res.json({ status: 'created', provider: 'email', amount: amt });
});

// ========================================
// EXPORT CommonJS
// ========================================
module.exports = router;
