const express = require('express');
const router = express.Router();

// Chemins corrects depuis routes/account/
const db = require('../../db/sqlite');
const { requireAuth } = require('../../middleware/auth');

// ======================================
// Sélecteur utilisateur
// ======================================
const selUser = db.prepare(`
  SELECT id,
         email,
         name,
         COALESCE(age_bucket, ageBucket) AS ageBucket,
         theme,
         analytics,
         credits
  FROM users
  WHERE id = ?
`);

function toPayload(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name ?? '',
    ageBucket: row.ageBucket ?? '-',
    theme: row.theme ?? 'system',
    analytics: !!row.analytics,
    credits: Number.isFinite(row.credits) ? Number(row.credits) : 0
  };
}

// ======================================
// GET /api/account/me
// ======================================
router.get('/me', requireAuth, (req, res) => {
  const uid = Number(req.user?.id);
  if (!Number.isFinite(uid)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const row = selUser.get(uid);
  if (!row) {
    return res.status(404).json({ error: 'introuvable' });
  }

  res.json(toPayload(row));
});

// ======================================
// PUT /api/account/me
// ======================================
router.put('/me', requireAuth, (req, res) => {
  const uid = Number(req.user?.id);
  if (!Number.isFinite(uid)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const body = req.body || {};
  const sets = [];
  const vals = [];

  // ---- name ----------------------------------------------------
  if ('name' in body) {
    const cleaned = String(body.name || '').trim().slice(0, 120);
    sets.push('name = ?');
    vals.push(cleaned || null);
  }

  // ---- ageBucket -----------------------------------------------
  if ('ageBucket' in body) {
    const allowed = new Set(['-', '<18', '18-24', '25-34', '35-49', '50-64', '65+']);
    const v = body.ageBucket == null ? null : String(body.ageBucket);

    if (v && !allowed.has(v)) {
      return res.status(422).json({ error: 'ageBucket invalide' });
    }

    // Normalisation
    const normalized = (v === '-' ? null : v);

    // 👉 On met à jour UNIQUEMENT la colonne officielle
    sets.push('age_bucket = ?');
    vals.push(normalized);
  }

  // ---- theme ---------------------------------------------------
  if ('theme' in body) {
    const allowed = new Set(['system', 'light', 'dark']);
    const v = body.theme == null ? null : String(body.theme);
    if (!allowed.has(v)) {
      return res.status(422).json({ error: 'theme invalide' });
    }
    sets.push('theme = ?');
    vals.push(v);
  }

  // ---- analytics -----------------------------------------------
  if ('analytics' in body) {
    sets.push('analytics = ?');
    vals.push(body.analytics ? 1 : 0);
  }

  if (!sets.length) {
    return res.status(400).json({ error: 'Rien à mettre à jour' }); // encodage propre
  }

  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, uid);

  const updated = selUser.get(uid);
  res.json(toPayload(updated));
});

// ======================================
// EXPORT CommonJS
// ======================================
module.exports = router;
