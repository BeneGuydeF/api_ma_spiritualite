// routes/auth.signup.js — GROS BACK (CommonJS)

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/sqlite'); // même DB que login
const router = express.Router();

const SECRET = process.env.JWT_SECRET || 'change-me';

// Politique mot de passe : 12+ caractères, lettres, chiffres, caractère spécial
const policy = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;

router.post('/signup', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis.' });
    }

    if (!policy.test(password)) {
      return res.status(422).json({
        error: 'Mot de passe trop faible.',
        details: 'Minimum 12 caractères avec lettre, chiffre et caractère spécial.'
      });
    }

    const e = String(email).trim().toLowerCase();

    // Vérifier si l’utilisateur existe déjà
    const existing = db.prepare(`
      SELECT id FROM users WHERE email = ?
    `).get(e);

    if (existing) {
      return res.status(409).json({ error: 'Cet email est déjà utilisé.' });
    }

    // Hash
    const hash = await bcrypt.hash(password, 12);

    // Création user cloud
    const result = db.prepare(`
      INSERT INTO users (email, password_hash, credits, age_bucket)
      VALUES (?, ?, 60, NULL)
    `).run(e, hash);

    const id = result.lastInsertRowid;

    // Token CLOUD
    const token = jwt.sign(
      { sub: id, email: e, scope: 'cloud' },
      SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      ok: true,
      token,
      user: {
        id,
        email: e,
        credits: 60,
        ageBucket: null
      }
    });

  } catch (err) {
    console.error('Erreur signup cloud :', err);
    return res.status(500).json({ error: 'Erreur interne.' });
  }
});

module.exports = router;
