const express = require("express");
const { requireAuth, requireCredits, csrfProtection } = require("../middleware/auth.js");
const { logSecurityEvent } = require("../utils/logger.js");
const userRepo = require("../models/user.repo.js");
const db = require("../db.js");
const { decryptData } = require("../utils/crypto.js");

const router = express.Router();

// --- Vérification du secret ---
if (!process.env.JWT_SECRET) {
  console.error("❌ JWT_SECRET manquant. Arrêt du module journal_secure.js");
  process.exit(1);
}

// --- Middlewares communs ---
// On garde requireAuth + CSRF + journalisation, mais pas le rate limiter de login
router.use(requireAuth, csrfProtection, (req, res, next) => {
  logSecurityEvent("journal_access", req.user?.id, req.method + " " + req.originalUrl);
  next();
});

// --- whoami ---
router.get("/whoami", async (req, res) => {
  try {
    const user = await userRepo.getById(req.user.id);
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
    res.json({ ok: true, user: { id: user.id, email: user.email, credits: user.credits } });
  } catch (err) {
    logSecurityEvent("journal_whoami_failed", req.user?.id, err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// --- crédits ---
router.get("/credits", async (req, res) => {
  try {
    const user = await userRepo.getById(req.user.id);
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
    res.json({ credits: user.credits });
  } catch (err) {
    logSecurityEvent("journal_credits_failed", req.user?.id, err.message);
    res.status(500).json({ error: "Erreur lors de la récupération des crédits" });
  }
});

// --- nouvelle entrée ---
router.post("/entries", requireCredits(), async (req, res) => {
  try {
    const userId = req.user.id;
    const { content, title, tags } = req.body;

    if (!content) return res.status(400).json({ error: "Contenu obligatoire" });

    await db.run(
      `INSERT INTO journal_entries (user_id, title, content, tags, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [userId, title || null, content, tags ? JSON.stringify(tags) : null]
    );

    // décrémentation via le repo utilisateur (aligné avec carnet.js)
    await userRepo.updateCredits(userId, -1, "journal_entry");

    res.json({ ok: true, message: "Entrée enregistrée" });
  } catch (err) {
    logSecurityEvent("journal_entry_failed", req.user?.id, err.message);
    res.status(500).json({ error: "Erreur interne" });
  }
});

// --- lecture des entrées ---
router.get("/entries", async (req, res) => {
  try {
    const userId = req.user.id;
    const rows = await db.all(
      `SELECT id, title, content, tags, created_at
       FROM journal_entries WHERE user_id = ? ORDER BY created_at DESC`,
      [userId]
    );

    const entries = rows.map((r) => ({
      ...r,
      content: decryptData ? decryptData(r.content) : r.content,
      tags: r.tags ? JSON.parse(r.tags) : [],
    }));

    res.json({ ok: true, entries });
  } catch (err) {
    logSecurityEvent("journal_read_failed", req.user?.id, err.message);
    res.status(500).json({ error: "Erreur lors de la lecture des entrées" });
  }
});

module.exports = router;
