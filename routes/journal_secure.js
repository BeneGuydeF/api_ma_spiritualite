const express = require('express');
const {
  requireAuth,
  requireCredits,
  csrfProtection,
  sensitiveRateLimit,
} = require('../middleware/auth');
const userRepo = require('../models/user.repo');
const journalRepo = require('../models/journal.repo');
const creditsRepo = require('../models/credits.repo');
const {
  encrypt,
  decrypt,
  encryptJSON,
  decryptJSON,
  generateSalt,
} = require('../utils/crypto');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET manquant : journal_secure indisponible');
}

const JOURNAL_ENCRYPTION_KEY = process.env.JOURNAL_ENCRYPTION_KEY;
if (!JOURNAL_ENCRYPTION_KEY) {
  throw new Error(
    'JOURNAL_ENCRYPTION_KEY manquant : définis une clé dédiée (>=32 caractères) pour le carnet sécurisé',
  );
}
if (JOURNAL_ENCRYPTION_KEY.length < 32) {
  throw new Error('JOURNAL_ENCRYPTION_KEY trop court : minimum 32 caractères requis');
}

function auditJournalAccess(req, res, next) {
  const started = Date.now();
  res.on('finish', () => {
    const status = res.statusCode;
    const shouldLog = status >= 400 || req.method === 'POST' || req.method === 'DELETE';
    if (!shouldLog) return;

    const userId = req.user?.id ?? 'anonymous';
    console.warn(
      `[journal_secure] ${req.method} ${req.originalUrl} -> ${status} (user=${userId}, duration=${
        Date.now() - started
      }ms)`,
    );
  });
  next();
}

router.use('/journal_secure', requireAuth, csrfProtection, auditJournalAccess);

const sanitize = (value) => (typeof value === 'string' ? value.replace(/\u200B/g, '').trim() : '');

function normalizeTags(rawTags) {
  if (!Array.isArray(rawTags)) return [];
  return rawTags
    .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
    .filter(Boolean)
    .slice(0, 20);
}

function ensureUser(userId) {
  const user = userRepo.getById(userId);
  if (!user) {
    const err = new Error('Utilisateur introuvable');
    err.status = 404;
    throw err;
  }
  if (!user.encryptionSalt) {
    const encryptionSalt = generateSalt();
    userRepo.setEncryptionSalt({ userId: user.id, encryptionSalt });
    user.encryptionSalt = encryptionSalt;
  }
  return user;
}

function serializeEncrypted(payload) {
  return payload ? JSON.stringify(payload) : null;
}

function parseEncryptedField(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

function decryptEntry(user, entry) {
  const encryptedContent = parseEncryptedField(entry.encryptedContent);
  let content = '';
  if (encryptedContent) {
    content = decrypt(
      encryptedContent.encryptedData,
      encryptedContent.iv,
      encryptedContent.tag,
      JOURNAL_ENCRYPTION_KEY,
      user.encryptionSalt,
    );
  }

  const encryptedTags = parseEncryptedField(entry.encryptedTags);
  let tags = [];
  if (encryptedTags) {
    try {
      tags = decryptJSON(
        encryptedTags.encryptedData,
        encryptedTags.iv,
        encryptedTags.tag,
        JOURNAL_ENCRYPTION_KEY,
        user.encryptionSalt,
      );
    } catch {
      tags = [];
    }
  }

  return {
    id: entry.id,
    title: entry.title,
    content,
    tags,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

router.get('/journal_secure/whoami', (req, res) => {
  try {
    const user = ensureUser(req.user.id);
    return res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        credits: user.credits,
      },
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ error: error.message });
  }
});

router.get('/journal_secure/credits', (req, res) => {
  try {
    const user = ensureUser(req.user.id);
    return res.json({ credits: user.credits });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ error: error.message });
  }
});
// Compat legacy: /journal_secure/create -> /journal_secure/entries
router.post('/journal_secure/create', (req, res, next) => {
  req.url = '/journal_secure/entries';
  next();
});
// Compat: certains clients doublent le préfixe
router.post('/journal_secure/journal_secure/create', (req, res, next) => {
  req.url = '/journal_secure/entries';
  next();
});

router.post(
  '/journal_secure/entries',
  sensitiveRateLimit,
  requireCredits(1),
  (req, res) => {
    let createdEntryId = null;
    try {
      const user = ensureUser(req.user.id);
      const content = sanitize(req.body?.content);
      if (!content) {
        return res.status(400).json({ error: 'Contenu obligatoire' });
      }

      const title = sanitize(req.body?.title) || 'Sans titre';
      const tags = normalizeTags(req.body?.tags);

      const encryptedContent = encrypt(content, JOURNAL_ENCRYPTION_KEY, user.encryptionSalt);
      const encryptedTags = tags.length
        ? encryptJSON(tags, JOURNAL_ENCRYPTION_KEY, user.encryptionSalt)
        : null;

      const result = journalRepo.create({
        userId: user.id,
        title,
        encryptedContent: serializeEncrypted(encryptedContent),
        encryptedTags: serializeEncrypted(encryptedTags),
        iv: encryptedContent.iv,
      });
      createdEntryId = result.lastInsertRowid;

      const remainingCredits = creditsRepo.deductCredits(
        user.id,
        1,
        'journal_secure_entry',
      );

      req.user.credits = remainingCredits;

      return res.status(201).json({
        ok: true,
        entryId: createdEntryId,
        title,
        credits: remainingCredits,
      });
    } catch (error) {
      if (createdEntryId) {
        journalRepo.delete(createdEntryId, req.user.id);
      }

      if (error.message === 'Crédits insuffisants') {
        return res.status(402).json({ error: error.message });
      }

      const status = error.status || 500;
      return res.status(status).json({ error: error.message || 'Erreur interne' });
    }
  },
);

router.get('/journal_secure/entries', (req, res) => {
  try {
    const user = ensureUser(req.user.id);
    const rows = journalRepo.getAllWithContent(user.id);
    const entries = rows.map((row) => decryptEntry(user, row));
    return res.json({ ok: true, entries });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ error: error.message });
  }
});

router.get('/journal_secure/entries/:id', (req, res) => {
  try {
    const user = ensureUser(req.user.id);
    const entryId = Number(req.params.id);
    if (!Number.isFinite(entryId)) {
      return res.status(400).json({ error: 'Identifiant invalide' });
    }

    const entry = journalRepo.getWithContent(entryId, user.id);
    if (!entry) {
      return res.status(404).json({ error: 'Entrée introuvable' });
    }

    return res.json({ ok: true, entry: decryptEntry(user, entry) });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ error: error.message });
  }
});

module.exports = router;
