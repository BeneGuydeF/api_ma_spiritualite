// routes/carnet.js  (CommonJS — plug and play avec index.js en require)
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db'); // même db que les autres routes

const router = express.Router();
console.log('🗂️ routes/carnet.js chargé');
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';

// ————— Helpers —————
function verifyToken(req) {
  const header = req.headers && req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    const err = new Error('TOKEN_MISSING'); err.status = 401; throw err;
  }
  const token = header.slice(7).trim();
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    const err = new Error('TOKEN_INVALID'); err.status = 401; throw err;
  }
}

function sanitize(s) {
  if (s == null) return '';
  return String(s).replace(/\u200B/g, '').trim();
}

function dateSlug(d = new Date()) {
  const y = String(d.getFullYear()).padStart(4, '0');
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}_${m}_${day}`;
}

const RUBRICS = new Set(['evangile', 'reflexions', 'examen', 'blocnotes', 'enfants']);

// Alias de compat → rubrique canonique (adulte vs enfants)
function normalizeRubric(raw) {
  const s = sanitize(raw).toLowerCase();
  if (['lecture', 'evangile', 'évangile'].includes(s)) return 'evangile';
  if (['priere', 'prière', 'reflexions', 'réflexions', 'notes perso', 'notes_personnelles'].includes(s)) return 'reflexions';
  if (['confession', 'examen', 'examen de conscience'].includes(s)) return 'examen';
  if (['notes', 'bloc-notes', 'notes_perso', 'notes personnelles'].includes(s)) return 'blocnotes';
  if (['journal enfants', 'journal des enfants', 'enfants'].includes(s)) return 'enfants';
  // par défaut, ranger en blocnotes (évite 422 inutile)
  return 'blocnotes';
}

// ————— Init tables minimales au cas où (optionnel, idempotent) —————
try {
  db.prepare(`CREATE TABLE IF NOT EXISTS journal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    titre TEXT NOT NULL,
    contenu TEXT NOT NULL,
    rubrique TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
} catch (e) {
  console.warn('journal_entries table check failed:', e.message);
}
try {
  db.prepare('CREATE INDEX IF NOT EXISTS idx_journal_user_created ON journal_entries(user_id, created_at DESC)').run();
} catch (e) {
  console.warn('journal_entries index check failed:', e.message);
}
// ————— Status crédits (pour flouter côté front) —————
// GET /api/carnet/status  -> { credits: number, locked: boolean }
router.get('/carnet/status', (req, res) => {
  try {
    const payload = verifyToken(req);
    const userId = Number(payload?.sub ?? payload?.id);
    if (!Number.isFinite(userId)) return res.status(401).json({ error: 'token invalide' });

    let credits = 0;
    try {
      const row = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId);
      credits = row?.credits ?? 0;
    } catch {
      credits = 0;
    }

    const locked = credits <= 0;
    return res.json({ credits, locked });
  } catch (err) {
    const status = err.status || 401;
    return res.status(status).json({ error: err.message === 'TOKEN_MISSING' ? 'token requis' : 'token invalide' });
  }
});

// ————— Create —————
// POST /api/carnet/entries { titre?, contenu, rubrique }
router.post('/carnet/entries', (req, res) => {
  try {
    const payload = verifyToken(req);
    const userId = Number(payload?.sub ?? payload?.id);
    if (!Number.isFinite(userId)) return res.status(401).json({ error: 'token invalide' });

    const contenu = sanitize(req.body?.contenu);
    let titre = sanitize(req.body?.titre);
    const rubrique = normalizeRubric(req.body?.rubrique);

    if (!contenu) return res.status(422).json({ error: 'contenu requis' });
    if (!RUBRICS.has(rubrique)) return res.status(422).json({ error: 'rubrique invalide' });

    if (!titre) titre = dateSlug(); // titre auto

    // (Optionnel) bloquer la création si crédits <= 0 :
    // const creditsRow = db.prepare('SELECT credits FROM users WHERE id=?').get(userId);
    // if (!creditsRow || creditsRow.credits <= 0) return res.status(402).json({ error: 'credits insuffisants' });

    const now = new Date().toISOString();
    const st = db.prepare(
      'INSERT INTO journal_entries(user_id, titre, contenu, rubrique, created_at, updated_at) VALUES (?,?,?,?,?,?)'
    );
    const result = st.run(userId, titre, contenu, rubrique, now, now);

    return res.status(201).json({
      id: result.lastInsertRowid,
      titre, contenu, rubrique,
      createdAt: now, updatedAt: now,
    });
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error('POST /api/carnet/entries', err);
    return res.status(status).json({ error: err.message === 'TOKEN_MISSING' ? 'token requis' : 'token invalide' });
  }
});

// ————— List —————
// GET /api/carnet/entries?rubrique=reflexions&limit=50&offset=0
router.get('/carnet/entries', (req, res) => {
  try {
    const payload = verifyToken(req);
    const userId = Number(payload?.sub ?? payload?.id);
    if (!Number.isFinite(userId)) return res.status(401).json({ error: 'token invalide' });

    const rawRub = req.query.rubrique;
    const rubrique = rawRub ? normalizeRubric(rawRub) : null;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    let rows;
    if (rubrique && RUBRICS.has(rubrique)) {
      rows = db.prepare(
        'SELECT id, titre, contenu, rubrique, created_at AS createdAt, updated_at AS updatedAt FROM journal_entries WHERE user_id=? AND rubrique=? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      ).all(userId, rubrique, limit, offset);
    } else {
      rows = db.prepare(
        'SELECT id, titre, contenu, rubrique, created_at AS createdAt, updated_at AS updatedAt FROM journal_entries WHERE user_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      ).all(userId, limit, offset);
    }

    return res.json({ items: rows, limit, offset });
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error('GET /api/carnet/entries', err);
    return res.status(status).json({ error: err.message === 'TOKEN_MISSING' ? 'token requis' : 'token invalide' });
  }
});

// ————— Read —————
// GET /api/carnet/entries/:id
router.get('/carnet/entries/:id', (req, res) => {
  try {
    const payload = verifyToken(req);
    const userId = Number(payload?.sub ?? payload?.id);
    if (!Number.isFinite(userId)) return res.status(401).json({ error: 'token invalide' });

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id invalide' });

    const row = db.prepare(
      'SELECT id, titre, contenu, rubrique, created_at AS createdAt, updated_at AS updatedAt FROM journal_entries WHERE id=? AND user_id=?'
    ).get(id, userId);

    if (!row) return res.status(404).json({ error: 'introuvable' });
    return res.json(row);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error('GET /api/carnet/entries/:id', err);
    return res.status(status).json({ error: err.message === 'TOKEN_MISSING' ? 'token requis' : 'token invalide' });
  }
});

// ————— Update —————
// PUT /api/carnet/entries/:id { titre?, contenu?, rubrique? }
router.put('/carnet/entries/:id', (req, res) => {
  try {
    const payload = verifyToken(req);
    const userId = Number(payload?.sub ?? payload?.id);
    if (!Number.isFinite(userId)) return res.status(401).json({ error: 'token invalide' });

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id invalide' });

    const titre = sanitize(req.body?.titre);
    const contenu = sanitize(req.body?.contenu);
    const rubriqueRaw = req.body?.rubrique;
    const now = new Date().toISOString();

    // Vérifier ownership
    const exists = db.prepare('SELECT id FROM journal_entries WHERE id=? AND user_id=?').get(id, userId);
    if (!exists) return res.status(404).json({ error: 'introuvable' });

    // Construire l’update dynamiquement
    const fields = [];
    const vals = [];
    if (titre) { fields.push('titre = ?'); vals.push(titre); }
    if (contenu) { fields.push('contenu = ?'); vals.push(contenu); }
    if (rubriqueRaw) {
      const rub = normalizeRubric(rubriqueRaw);
      if (!RUBRICS.has(rub)) return res.status(422).json({ error: 'rubrique invalide' });
      fields.push('rubrique = ?'); vals.push(rub);
    }
    fields.push('updated_at = ?'); vals.push(now);
    vals.push(id, userId);

    const sql = `UPDATE journal_entries SET ${fields.join(', ')} WHERE id=? AND user_id=?`;
    db.prepare(sql).run(...vals);

    const row = db.prepare(
      'SELECT id, titre, contenu, rubrique, created_at AS createdAt, updated_at AS updatedAt FROM journal_entries WHERE id=? AND user_id=?'
    ).get(id, userId);

    return res.json(row);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error('PUT /api/carnet/entries/:id', err);
    return res.status(status).json({ error: err.message === 'TOKEN_MISSING' ? 'token requis' : 'token invalide' });
  }
});

// ————— Delete (définitif) —————
// DELETE /api/carnet/entries/:id
router.delete('/carnet/entries/:id', (req, res) => {
  try {
    const payload = verifyToken(req);
    const userId = Number(payload?.sub ?? payload?.id);
    if (!Number.isFinite(userId)) return res.status(401).json({ error: 'token invalide' });

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id invalide' });

    const del = db.prepare('DELETE FROM journal_entries WHERE id=? AND user_id=?').run(id, userId);
    if (del.changes === 0) return res.status(404).json({ error: 'introuvable' });

    return res.status(204).send();
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error('DELETE /api/carnet/entries/:id', err);
    return res.status(status).json({ error: err.message === 'TOKEN_MISSING' ? 'token requis' : 'token invalide' });
  }
});

module.exports = router;
