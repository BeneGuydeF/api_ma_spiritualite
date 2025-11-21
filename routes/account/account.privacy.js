import express from 'express';
import db from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';

const router = express.Router();
const exists = (t) => !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);

const selUser = db.prepare(`
  SELECT id,email,name,age_bucket AS ageBucket,theme,analytics,credits,created_at AS createdAt
  FROM users WHERE id = ?
`);
const selJournal = exists('journal_entries')
  ? db.prepare(`SELECT id,titre,contenu,rubrique,created_at AS createdAt FROM journal_entries WHERE user_id=? ORDER BY created_at ASC`)
  : null;

router.post('/export', requireAuth, (req, res) => {
  const uid = Number(req.user?.id);
  if (!Number.isFinite(uid)) return res.status(401).json({ error: 'unauthorized' });
  const user = selUser.get(uid);
  if (!user) return res.status(404).json({ error: 'introuvable' });

  const journal = selJournal ? selJournal.all(uid) : [];
  res.json({ user, journal, payments: [] });
});

router.delete('/', requireAuth, (req, res) => {
  const uid = Number(req.user?.id);
  if (!Number.isFinite(uid)) return res.status(401).json({ error: 'unauthorized' });

  if (exists('journal_entries')) db.prepare('DELETE FROM journal_entries WHERE user_id=?').run(uid);
  db.prepare('DELETE FROM users WHERE id=?').run(uid);
  res.json({ ok: true });
});

router.get('/legal/:doc(cgv|rgpd|mentions)', (req, res) => {
  const docs = {
    cgv: { title: 'CGV', html: '<h1>CGV</h1><p>Conditions générales de vente…</p>' },
    rgpd:{ title: 'RGPD', html: '<h1>RGPD</h1><p>Politique de confidentialité…</p>' },
    mentions:{ title: 'Mentions légales', html: '<h1>Mentions</h1><p>Éditeur: Keryxi Dev…</p>' },
  };
  const d = docs[req.params.doc];
  if (!d) return res.status(404).json({ error: 'introuvable' });
  res.json(d);
});

export default router;