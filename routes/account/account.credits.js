const express = require('express');
const router = express.Router();

const db = require('../../db/sqlite');
const { requireAuth } = require('../../middleware/auth');

const exists = (t) =>
  !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);

const selCredits = db.prepare('SELECT credits FROM users WHERE id = ?');

const selHistory = exists('credit_transactions')
  ? db.prepare(`
      SELECT 
        createdAt AS date,     -- CORRECT pour ta base
        type,
        amount,
        provider,
        paymentId,
        description
      FROM credit_transactions
      WHERE user_id=?
      ORDER BY createdAt DESC
    `)
  : null;

router.get('/credits/status', requireAuth, (req, res) => {
  const uid = Number(req.user?.id);
  if (!Number.isFinite(uid)) return res.status(401).json({ error: 'unauthorized' });

  const row = selCredits.get(uid);
  if (!row) return res.status(404).json({ error: 'introuvable' });

  const credits = Number(row.credits) || 0;
  res.json({ credits, locked: credits <= 0 });
});

router.get('/payments/history', requireAuth, (req, res) => {
  const uid = Number(req.user?.id);
  if (!Number.isFinite(uid)) return res.status(401).json({ error: 'unauthorized' });

  if (!selHistory) return res.json({ items: [], note: 'history_unavailable' });

  res.json({ items: selHistory.all(uid) });
});

router.post('/donations/create', requireAuth, (req, res) => {
  const amt = Number(req.body?.amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: 'montant invalide' });
  }

  res.json({ status: 'created', provider: 'email', amount: amt });
});

module.exports = router;
