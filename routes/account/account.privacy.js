const express = require('express');
const router = express.Router();

// chemins corrects depuis routes/account/
const db = require('../../lib/db');
const { requireAuth } = require('../../middleware/auth');

// Vérifie si une table existe
const exists = (t) =>
  !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);

// Sélecteurs
const selUser = db.prepare(`
  SELECT id,
         email,
         name,
         age_bucket AS ageBucket,
         theme,
         analytics,
         credits,
         created_at AS createdAt
  FROM users
  WHERE id = ?
`);

const selJournal = exists('journal_entries')
  ? db.prepare(`
      SELECT id,
             titre,
             contenu,
             rubrique,
             created_at AS createdAt
      FROM journal_entries
      WHERE user_id = ?
      ORDER BY created_at ASC
    `)
  : null;

// =======================================
// POST /api/account/export
// =======================================
router.post('/export', requireAuth, (req, res) => {
  const uid = Number(req.user?.id);
  if (!Number.isFinite(uid)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const user = selUser.get(uid);
  if (!user) {
    return res.status(404).json({ error: 'introuvable' });
  }

  const journal = selJournal ? selJournal.all(uid) : [];

  // tu pourras ajouter les paiements plus tard
  res.json({
    user,
    journal,
    payments: []
  });
});

// =======================================
// DELETE /api/account/
// =======================================
router.delete('/', requireAuth, (req, res) => {
  const uid = Number(req.user?.id);
  if (!Number.isFinite(uid)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (exists('journal_entries')) {
    db.prepare('DELETE FROM journal_entries WHERE user_id = ?').run(uid);
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(uid);

  res.json({ ok: true });
});

// =======================================
// GET /api/account/legal/:doc(cgv|rgpd|mentions)
// =======================================
router.get('/legal/:doc(cgv|rgpd|mentions)', (req, res) => {
  const docs = {
    cgv: {
      title: 'CGV',
      html: '<h1>CGV</h1><p>Conditions générales de vente…</p>'
    },
    rgpd: {
      title: 'RGPD',
      html: '<h1>RGPD</h1><p>Politique de confidentialité…</p>'
    },
    mentions: {
      title: 'Mentions légales',
      html: '<h1>Mentions</h1><p>Éditeur: Keryxi Dev…</p>'
    }
  };

  const d = docs[req.params.doc];
  if (!d) {
    return res.status(404).json({ error: 'introuvable' });
  }

  res.json(d);
});

// =======================================
// EXPORT CommonJS
// =======================================
module.exports = router;
