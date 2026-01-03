// routes/auth.carnet.js — version SQLite (CommonJS)
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const users = require('../models/user.repo');
const db = require('../db/sqlite');
const { generateToken, loginRateLimit, sensitiveRateLimit, logSecurityEvent, csrfProtection } = require('../middleware/auth');
const Joi = require('joi');

const router = express.Router();

// Appliquer les middlewares de sécurité
//router.use(logSecurityEvent);
//router.use(csrfProtection);

const normEmail  = (s='') => s.toString().trim().toLowerCase();
const normAnswer = (s='') => s.toString().trim().toLowerCase().replace(/\s+/g, ' ');
const nowISO = () => new Date().toISOString();

const ok  = (res, data) => res.json(data);
const err = (res, code, msg) => res.status(code).json({ error: msg });

// Schémas de validation
const initSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(10).max(128).required(),
  ageBucket: Joi.string().optional()
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

const forgotAnswerSchema = Joi.object({
  email: Joi.string().email().required(),
  answer: Joi.string().min(1).max(255).required(),
  newPassword: Joi.string().min(10).max(128).required()
});

// 1) INIT (première ouverture)
// POST /api/auth/carnet/init { email, password, ageBucket? }
router.post('/carnet/init', sensitiveRateLimit, async (req, res) => {
  try {
    const { error } = initSchema.validate(req.body);
    if (error) return err(res, 400, error.details[0].message);

    const { email, password, ageBucket } = req.body;
    const e = normEmail(email);

    const exists = users.getByEmail(e);
    if (exists) return err(res, 409, 'Un compte existe déjà avec cet e-mail.');

    const passwordHash = await bcrypt.hash(password, 12);
    const result = users.create({
      email: e,
      passwordHash,
      ageBucket: ageBucket ?? null,
      secretQuestion: null,
      secretAnswerHash: null,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    });
try {
  db.prepare(`UPDATE users SET age_bucket = ? WHERE id = ?`)
    .run(ageBucket ?? null, result.lastInsertRowid);
} catch(e) {}
    const user = users.getById(result.lastInsertRowid);
    const token = generateToken(user.id, user.email);
    
    return ok(res, { 
      message: 'Compte carnet créé.',
      token,
      user: {
        id: user.id,
        email: user.email,
        credits: user.credits,
        ageBucket: user.ageBucket
      }
    });
  } catch (e) {
    console.error(e);
    return err(res, 500, 'Erreur serveur');
  }
});

router.post('/login', (req, res, next) => {
  req.url = '/carnet/login';
  next();
});

// 2) LOGIN (ouvertures suivantes)
// POST /api/auth/carnet/login { email, password }
router.post('/carnet/login', loginRateLimit, async (req, res) => {
  try {
    const { error } = loginSchema.validate(req.body);
    if (error) return err(res, 400, error.details[0].message);

   const { email, password } = req.body || {};
if (!email || !password) {
  return res.status(400).json({ error: "email et password requis" });
}
    const e = normEmail(email);
    
    const u = users.getByEmail(e);
    if (!u) return err(res, 401, 'Identifiants invalides.');
    
    const okPw = await bcrypt.compare(password, u.passwordHash);
    if (!okPw) return err(res, 401, 'Identifiants invalides.');
    
    const token = generateToken(u.id, u.email);
    
    return ok(res, { 
      message: 'Connexion réussie',
      token,
      user: {
        id: u.id,
        email: u.email,
        credits: u.credits,
        ageBucket: u.ageBucket
      }
    });
  } catch (e) {
    console.error(e);
    return err(res, 500, 'Erreur serveur');
  }
});
// =============================
// ROUTES PROTÉGÉES (TOKEN REQUIS)
// =============================
const protectedRouter = express.Router();
const { requireAuth } = require('../middleware/auth');

protectedRouter.use(requireAuth);
protectedRouter.use(logSecurityEvent);
protectedRouter.use(csrfProtection);

// Exemple de routes protégées
protectedRouter.get('/protected/ping', (req, res) => {
  res.json({ ok: true, userId: req.user?.id });
});

// Monter les routes protégées sous /api/auth
router.use('/carnet/protected', protectedRouter);


// 3) FORGOT INIT — question secrète ?
// GET /api/auth/password/forgot/init?email=...
router.get('/password/forgot/init', sensitiveRateLimit, (req, res) => {
  try {
    const e = normEmail(req.query.email);
    if (!e) return err(res, 400, 'Email requis');
    const u = users.getByEmail(e);
    if (!u || !u.secretQuestion || !u.secretAnswerHash) return ok(res, { hasSecretQuestion: false });
    return ok(res, { hasSecretQuestion: true, question: u.secretQuestion });
  } catch (e) {
    console.error(e);
    return err(res, 500, 'Erreur serveur');
  }
});

// 4) FORGOT ANSWER — reset via question secrète
// POST /api/auth/password/forgot/answer { email, answer, newPassword }
router.post('/password/forgot/answer', sensitiveRateLimit, async (req, res) => {
  try {
    const { email, answer, newPassword } = req.body || {};
    const e = normEmail(email);
    const a = normAnswer(answer);
    if (!e || !a || !newPassword || newPassword.length < 10) return err(res, 400, 'Champs manquants / MDP trop court.');

    const u = users.getByEmail(e);
    if (!u || !u.secretAnswerHash) return err(res, 400, 'Méthode indisponible pour ce compte.');

    const okAns = await bcrypt.compare(a, u.secretAnswerHash);
    if (!okAns) return err(res, 400, 'Réponse incorrecte.');

    const newHash = await bcrypt.hash(newPassword, 12);
    users.setPassword({ email: e, passwordHash: newHash });
    return ok(res, { message: 'Mot de passe réinitialisé.' });
  } catch (e) {
    console.error(e);
    return err(res, 500, 'Erreur serveur');
  }
});

// 5) FORGOT EMAIL (fallback neutre) — optionnel
router.post('/password/forgot', sensitiveRateLimit, (req, res) => {
  const e = normEmail(req.body?.email);
  if (!e) return err(res, 400, 'Email requis');
  // TODO: générer token + mail si tu veux garder ce mode
  return ok(res, { message: 'Si un compte existe, un e-mail sera envoyé.' });
});

module.exports = router;
