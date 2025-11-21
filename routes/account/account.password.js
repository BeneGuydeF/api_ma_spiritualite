const express = require('express');
const router = express.Router();

// chemins corrects depuis routes/account/
const bcrypt = require('bcryptjs');
const db = require('../../db/sqlite');
const { requireAuth } = require('../../middleware/auth');

const getPwd = db.prepare('SELECT id, passwordHash FROM users WHERE id = ?');
setPwd = db.prepare('UPDATE users SET passwordHash = ? WHERE id = ?');

// Politique : 12+ caractères, lettres, chiffres, caractères spéciaux
const policy = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;

// ==========================================
// POST /api/account/change-password
// ==========================================
router.post('/change-password', requireAuth, async (req, res) => {
  const uid = Number(req.user?.id);
  if (!Number.isFinite(uid)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { oldPassword, newPassword } = req.body || {};

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'champs requis' });
  }

  if (!policy.test(newPassword)) {
    return res.status(422).json({
      error: 'mot de passe faible',
      details: '12+, lettre, chiffre, spécial'
    });
  }

  const row = getPwd.get(uid);
  if (!row || !row.passwordHash) {
    return res.status(404).json({ error: 'introuvable' });
  }

  const ok = await bcrypt.compare(oldPassword, row.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'ancien mot de passe incorrect' });
  }

  const next = await bcrypt.hash(newPassword, 10);
  setPwd.run(next, uid);

  res.json({ ok: true });
});

// ==========================================
// EXPORT CommonJS
// ==========================================
module.exports = router;
