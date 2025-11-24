const express = require('express');
const router = express.Router();

// chemins corrects depuis routes/account/
const bcrypt = require('bcryptjs');
const db = require('../../db/sqlite');
const { requireAuth } = require('../../middleware/auth');

const getPwd = db.prepare('SELECT id, passwordHash FROM users WHERE id = ?');
const setPwd = db.prepare('UPDATE users SET passwordHash = ? WHERE id = ?');

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
    return res.status(400).json({ error: 'Champs requis.' });
  }

  if (!policy.test(newPassword)) {
    return res.status(422).json({
      error: 'Mot de passe trop faible.',
      details: 'Minimum 12 caractères avec lettre, chiffre et caractère spécial.'
    });
  }

  const row = getPwd.get(uid);
  if (!row || !row.passwordHash) {
    return res.status(404).json({ error: 'Utilisateur introuvable.' });
  }

  const match = await bcrypt.compare(oldPassword, row.passwordHash);
  if (!match) {
    return res.status(401).json({ error: 'Ancien mot de passe incorrect.' });
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  setPwd.run(newHash, uid);

  return res.json({ ok: true });
});

// ==========================================
// EXPORT CommonJS
// ==========================================
module.exports = router;
