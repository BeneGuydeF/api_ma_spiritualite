// middleware/auth.js - Middleware d'authentification sécurisé
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const users = require('../models/user.repo');

// =====================
// JWT configuration
// =====================
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET missing or too short (min 32 chars)");
}
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// =====================
// Rate limiting
// =====================
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const sensitiveRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Trop de requêtes. Réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// =====================
// Token generation
// =====================
function generateToken(userId, email) {
  return jwt.sign(
    {
      userId,
      email,
      iat: Math.floor(Date.now() / 1000),
      jti: crypto.randomBytes(16).toString('hex'),
    },
    JWT_SECRET,
    {
      expiresIn: JWT_EXPIRES_IN,
      issuer: 'ma-spiritualite-api',
      audience: 'ma-spiritualite-app',
    }
  );
}

// =====================
// Token verification
// =====================
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET, {
      issuer: 'ma-spiritualite-api',
      audience: 'ma-spiritualite-app',
    });
  } catch (error) {
    throw new Error('Token invalide');
  }
}

// =====================
// AUTH MIDDLEWARE
// =====================
function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token d\'authentification requis' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    // Compatibilité : accepter userId OU sub selon l'origine du token
    const uid = decoded.userId ?? decoded.sub;

    if (!uid) {
      return res.status(401).json({ error: 'Token invalide (uid absent)' });
    }

    const user = users.getById(uid);
    if (!user) {
      return res.status(401).json({ error: 'Utilisateur non trouvé' });
    }

    // Ajouter l'utilisateur à req
    req.user = {
      id: user.id,
      email: user.email,
      credits: user.credits || 0,
      encryptionSalt: user.encryptionSalt
    };

    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token invalide' });
  }
}

// =====================
// Middlewares utilitaires
// =====================
function requireCredits(minCredits = 1) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentification requise' });
    }

    if (req.user.credits < minCredits) {
      return res.status(402).json({
        error: 'Crédits insuffisants',
        required: minCredits,
        available: req.user.credits,
      });
    }

    next();
  };
}

function validateInput(schema) {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Données invalides',
        details: error.details.map((d) => d.message),
      });
    }
    next();
  };
}

function logSecurityEvent(req, res, next) {
  const originalSend = res.send;
  res.send = function (data) {
    if (res.statusCode === 401 || res.statusCode === 403) {
      console.warn(
        `[SECURITY] ${new Date().toISOString()} - ${req.method} ${req.path} - IP: ${req.ip} - Status: ${res.statusCode}`
      );
    }
    originalSend.call(this, data);
  };
  next();
}

function csrfProtection(req, res, next) {
  const origin = req.get('Origin') || req.get('Referer');
  const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim());

  if (req.method !== 'GET' && origin && !allowedOrigins.some((allowed) => origin.startsWith(allowed))) {
    return res.status(403).json({ error: 'Origine non autorisée' });
  }

  next();
}

// =====================
// EXPORTS
// =====================
module.exports = {
  generateToken,
  verifyToken,
  requireAuth,
  requireCredits,
  validateInput,
  logSecurityEvent,
  csrfProtection,
  loginRateLimit,
  sensitiveRateLimit,
};
