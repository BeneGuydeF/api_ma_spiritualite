// routes/auth.signup.js — GROS BACK (CommonJS)

const express = require('express');
const bcrypt = require('bcryptjs'); // plus simple + sync
const jwt = require('jsonwebtoken');
const db = require('../db/sqlite');
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

    const normalized = String(email).trim().toLowerCase();

    // Vérifier si l’utilisateur existe déjà
    const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(normalized);
    if (existing) {
      return res.status(409).json({ error: 'Cet email est déjà utilisé.' });
    }

    const hash = bcrypt.hashSync(password, 12);
    const now = new Date().toISOString();

    // INSERT adapté au schéma SQLite actuel
    const stmt = db.prepare(`
      INSERT INTO users (
        email,
        passwordHash,
        age_bucket,
        credits,
        encryptionSalt,
        createdAt,
        updatedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      normalized,
      hash,
      null,       // age_bucket
      10,         // crédits gratuits
      null,       // encryptionSalt pour plus tard
      now,
      now
    );

    const id = result.lastInsertRowid;

    const token = jwt.sign(
       { id, sub: id, email: normalized, scope: 'cloud' },
      SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      ok: true,
      token,
      user: {
        id,
        email: normalized,
        credits: 10,
        ageBucket: null
      }
    });

  } catch (err) {
    console.error("Erreur signup cloud :", err);
    return res.status(500).json({ error: "Erreur interne." });
  }
});

module.exports = router;
