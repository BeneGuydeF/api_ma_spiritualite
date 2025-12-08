// routes/auth.login.js — GROS BACK (CommonJS)

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/sqlite');

const router = express.Router();

// Le secret DOIT être identique et obligatoire
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET missing or too short");
}

// Aligné sur middleware/auth.js
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis.' });
    }

    const e = String(email).trim().toLowerCase();

    const row = db.prepare(`
      SELECT id,
             email,
             passwordHash,
             credits,
             age_bucket AS ageBucket
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

    // TOKEN 100% COMPATIBLE AVEC middleware/auth.js
    const token = jwt.sign(
      {
        userId: row.id,
        email: row.email,
        iat: Math.floor(Date.now() / 1000),
        jti: require('crypto').randomBytes(16).toString('hex')
      },
      JWT_SECRET,
      {
        expiresIn: JWT_EXPIRES_IN,
        issuer: 'ma-spiritualite-api',
        audience: 'ma-spiritualite-app'
      }
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
