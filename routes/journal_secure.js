// routes/journal_secure.js — carnet chiffré AES-GCM
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db/sqlite');
const { encryptJSON, decryptJSON } = require('../utils/crypto');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET manquant pour journal sécurisé');

// === Vérification du token ===
function verifyToken(req) {
  const header = req.headers['authorization'] || '';
  if (!header.startsWith('Bearer ')) throw new Error('TOKEN_MISSING');
  const token = header.slice(7).trim();
  return jwt.verify(token, JWT_SECRET, {
    issuer: 'ma-spiritualite-api',
    audience: 'ma-spiritualite-app'
  });
}

// === POST /api/journal_secure/entries ===
// Enregistre une note chiffrée (si crédits > 0)
router.post('/journal_secure/entries', (req, res) => {
  try {
    const payload = verifyToken(req);
    const user_id = payload.userId;
    const user = db.prepare('SELECT encryptionSalt, credits FROM users WHERE id=?').get(user_id);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

    const { title, contenu, tags } = req.body;
    if (!contenu) return res.status(422).json({ error: 'contenu requis' });

    // Mode éphémère si plus de crédits
    if (user.credits <= 0) {
      console.log('⚠️ Aucun crédit disponible — mode éphémère');
      return res.json({ ephemeral: true, message: 'Note non sauvegardée (crédits épuisés)' });
    }

    const now = new Date().toISOString();
    const data = { contenu, tags };
    const encrypted = encryptJSON(data, JWT_SECRET, user.encryptionSalt);

    db.prepare(`
      INSERT INTO journal_entries_secure
        (user_id, title, encryptedContent, encryptedTags, iv, tag, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user_id,
      title || '(sans titre)',
      encrypted.encryptedData,
      JSON.stringify(tags || []),
      encrypted.iv,
      encrypted.tag,
      now,
      now
    );

    res.json({ ok: true, saved: true, createdAt: now });
  } catch (err) {
    console.error('POST /journal_secure/entries', err.message);
    const msg = err.message.includes('TOKEN_MISSING')
      ? 'token requis'
      : err.message.includes('TOKEN_INVALID')
      ? 'token invalide'
      : err.message;
    res.status(401).json({ error: msg });
  }
});

// === GET /api/journal_secure/entries ===
// Retourne toutes les notes déchiffrées
router.get('/journal_secure/entries', (req, res) => {
  try {
    const payload = verifyToken(req);
    const user_id = payload.userId;
    const user = db.prepare('SELECT encryptionSalt FROM users WHERE id=?').get(user_id);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

    const rows = db
      .prepare(`
        SELECT id, title, encryptedContent, iv, tag, created_at, updated_at
        FROM journal_entries_secure
        WHERE user_id = ?
        ORDER BY created_at DESC
      `)
      .all(user_id);

    const decrypted = rows.map(row => {
      try {
        const data = decryptJSON(row.encryptedContent, row.iv, row.tag, JWT_SECRET, user.encryptionSalt);
        return { ...row, contenu: data.contenu, tags: data.tags || [] };
      } catch {
        return { ...row, contenu: '(Déchiffrement impossible)' };
      }
    });

    res.json({ items: decrypted });
  } catch (err) {
    console.error('GET /journal_secure/entries', err.message);
    const msg = err.message.includes('TOKEN_MISSING')
      ? 'token requis'
      : 'token invalide';
    res.status(401).json({ error: msg });
  }
});

module.exports = router;
