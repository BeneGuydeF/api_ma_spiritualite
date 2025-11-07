// routes/journal_secure.js — Carnet chiffré AES-256 moderne
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db/sqlite');
const {
  encrypt,
  decrypt,
  deriveKey
} = require('../utils/crypto');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

// Vérification du token
function verifyToken(req) {
  const header = req.headers['authorization'] || '';
  if (!header.startsWith('Bearer ')) {
    const err = new Error('TOKEN_MISSING');
    err.status = 401;
    throw err;
  }
  const token = header.slice(7).trim();
  try {
    return jwt.verify(token, JWT_SECRET, {
      issuer: 'ma-spiritualite-api',
      audience: 'ma-spiritualite-app'
    });
  } catch (e) {
    const err = new Error('TOKEN_INVALID');
    err.status = 401;
    throw err;
  }
}

// Nettoyage basique
function sanitize(s) {
  return typeof s === 'string' ? s.trim().replace(/\u200B/g, '') : '';
}

// === CREATE ===
router.post('/journal_secure/entries', (req, res) => {
  try {
    const payload = verifyToken(req);
    const userId = Number(payload?.sub ?? payload?.id ?? payload?.userId);
    if (!Number.isFinite(userId)) return res.status(401).json({ error: 'token invalide' });

    const title = sanitize(req.body?.title || 'Sans titre');
    const contenu = sanitize(req.body?.contenu || req.body?.content);
    const tags = req.body?.tags || [];

    if (!contenu) return res.status(422).json({ error: 'contenu requis' });

    // Récupère le sel utilisateur depuis la base
const user = db.prepare('SELECT encryptionSalt FROM users WHERE id=?').get(userId);
if (!user || !user.encryptionSalt) {
  throw new Error("Salt de chiffrement manquant pour cet utilisateur");
}

// Dérive une clé AES à partir du salt
const key = deriveKey(user.encryptionSalt);

// --- Chiffrement AES-256 via utils/crypto.js ---
const { encryptedData, iv } = encrypt(contenu, key);
const encryptedTags = encrypt(JSON.stringify(tags || []), key).encryptedData;
const now = new Date().toISOString();

const stmt = db.prepare(`
  INSERT INTO carnet_entries (userId, title, encryptedContent, encryptedTags, iv, createdAt, updatedAt)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const result = stmt.run(userId, title, encryptedData, encryptedTags, iv, now, now);

return res.status(201).json({ id: result.lastInsertRowid, title, createdAt: now });

  } catch (err) {
    console.error('POST /journal_secure/entries', err);
    const status = err.status || 500;
    return res.status(status).json({ error: err.message });
  }
});

// === READ (liste toutes les notes) ===
router.get('/journal_secure/entries', (req, res) => {
  try {
    const payload = verifyToken(req);
    const userId = Number(payload?.sub ?? payload?.id ?? payload?.userId);
    if (!Number.isFinite(userId)) return res.status(401).json({ error: 'token invalide' });

    const user = db.prepare('SELECT encryptionSalt FROM users WHERE id=?').get(userId);
    if (!user?.encryptionSalt) return res.status(500).json({ error: 'clé de chiffrement manquante' });

    const rows = db.prepare(`
      SELECT id, title, encryptedContent, encryptedTags, iv, createdAt, updatedAt
      FROM carnet_entries
      WHERE userId=?
      ORDER BY createdAt DESC
    `).all(userId);

    const items = rows.map(r => ({
      id: r.id,
      title: r.title,
      content: decryptData(r.encryptedContent, user.encryptionSalt, r.iv),
      tags: JSON.parse(decryptData(r.encryptedTags, user.encryptionSalt, r.iv) || '[]'),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    }));

    return res.json({ items });
  } catch (err) {
    console.error('GET /journal_secure/entries', err);
    const status = err.status || 500;
    return res.status(status).json({ error: err.message });
  }
});

module.exports = router;
