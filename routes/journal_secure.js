import express from "express";
import { requireAuth, requireCredits, csrfProtection, loginRateLimit } from "../middleware/auth.js";
import { logSecurityEvent } from "../utils/logger.js";
import userRepo from "../models/user.repo.js";
import db from "../db.js";
import { decryptData } from "../utils/crypto.js"; // facultatif si déjà global
import { validateEntry } from "../validators/journal.js"; // idem : optionnel selon ton schéma

const router = express.Router();

/**
 * Vérifie la présence du secret JWT
 */
if (!process.env.JWT_SECRET) {
  console.error("❌ JWT_SECRET manquant. Arrêt du module journal_secure.js");
  process.exit(1);
}

/**
 * Middlewares communs
 * Authentification + protection CSRF + limitation brute-force
 */
router.use(requireAuth, csrfProtection, loginRateLimit);

/**
 * GET /api/journal_secure/whoami
 * Retourne les informations basiques de l'utilisateur
 */
router.get("/whoami", async (req, res) => {
  try {
    const user = await userRepo.getById(req.user.userId);
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
    res.json({ ok: true, user: { id: user.id, email: user.email, credits: user.credits } });
  } catch (err) {
    logSecurityEvent("whoami_failed", req.user.userId, err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * GET /api/journal_secure/credits
 * Aligne la route avec le module carnet
 */
router.get("/credits", async (req, res) => {
  try {
    const user = await userRepo.getById(req.user.userId);
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
    res.json({ credits: user.credits });
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de la récupération des crédits" });
  }
});

/**
 * POST /api/journal_secure/entries
 * Enregistre une nouvelle entrée dans la table `journal_entries`
 */
router.post("/entries", requireCredits, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { content, title, tags } = req.body;

    // Validation éventuelle
    if (!content) return res.status(400).json({ error: "Contenu obligatoire" });
    if (validateEntry && !validateEntry(req.body))
      return res.status(400).json({ error: "Entrée invalide" });

    await db.run(
      `INSERT INTO journal_entries (user_id, title, content, tags, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [userId, title || null, content, tags ? JSON.stringify(tags) : null]
    );

    await db.run(
      `UPDATE users SET credits = credits - 1 WHERE id = ?`,
      [userId]
    );

    res.json({ ok: true, message: "Entrée enregistrée" });
  } catch (err) {
    logSecurityEvent("journal_entry_failed", req.user?.userId, err.message);
    res.status(500).json({ error: "Erreur interne" });
  }
});

/**
 * GET /api/journal_secure/entries
 * Lit les entrées depuis `journal_entries`
 */
router.get("/entries", async (req, res) => {
  try {
    const userId = req.user.userId;
    const rows = await db.all(
      `SELECT id, title, content, tags, created_at
       FROM journal_entries WHERE user_id = ? ORDER BY created_at DESC`,
      [userId]
    );

    // Déchiffrement éventuel
    const entries = rows.map((r) => ({
      ...r,
      content: decryptData ? decryptData(r.content) : r.content,
      tags: r.tags ? JSON.parse(r.tags) : [],
    }));

    res.json({ ok: true, entries });
  } catch (err) {
    logSecurityEvent("journal_read_failed", req.user?.userId, err.message);
    res.status(500).json({ error: "Erreur lors de la lecture des entrées" });
  }
});

export default router;
