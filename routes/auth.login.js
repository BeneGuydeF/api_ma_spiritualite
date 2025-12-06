// routes/auth.login.js — GROS BACK (CommonJS)

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/sqlite'); // même DB que account.* et journal_secure

const router = express.Router();
const SECRET = process.env.JWT_SECRET || 'change-me';

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis.' });
    }

    // Normalisation
    const e = String(email || '').trim().toLowerCase();

    // On récupère l’utilisateur cloud
    const row = db.prepare(`
      SELECT id, email, passwordHash, credits, ageBucket
      FROM users
      WHERE email = ?
    `).get(e);

    if (!row) {
      return res.status(401).json({ error: 'Identifiants invalides.' });
    }

    const ok = await bcrypt.compare(password, row.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Identifiants invalides.' });
    }

    const token = jwt.sign(
      { sub: row.id, email: row.email, scope: 'cloud' },
      SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      ok: true,
      token,
      user: {
        id: row.id,
        email: row.email,
        credits: row.credits,
        ageBucket: row.ageBucket
      }
    });

  } catch (err) {
    console.error('Erreur login cloud :', err);
    return res.status(500).json({ error: 'Erreur interne.' });
  }
});

module.exports = router;
