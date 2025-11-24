// middleware/auth.js - Middleware d'authentification sécurisé
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const users = require('../models/user.repo');

// JWT secret must be explicitly defined in environment (no fallback allowed)
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET missing or too short (min 32 chars)");
}
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Rate limiting pour les tentatives de connexion
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Maximum 5 tentatives par IP
  message: { error: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting pour les opérations sensibles
const sensitiveRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Trop de requêtes. Réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Génère un token JWT sécurisé
 */
function generateToken(userId, email) {
  return jwt.sign(
    { 
      userId, 
      email,
      iat: Math.floor(Date.now() / 1000),
      jti: require('crypto').randomBytes(16).toString('hex') // Identifiant unique du token
    },
    JWT_SECRET,
    { 
      expiresIn: JWT_EXPIRES_IN,
      issuer: 'ma-spiritualite-api',
      audience: 'ma-spiritualite-app'
    }
  );
}

/**
 * Vérifie et décode un token JWT
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET, {
      issuer: 'ma-spiritualite-api',
      audience: 'ma-spiritualite-app'
    });
  } catch (error) {
    throw new Error('Token invalide');
  }
}

/**
 * Middleware d'authentification
 */
function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token d\'authentification requis' });
    }
    
    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    
    // Vérifier que l'utilisateur existe toujours
    const user = users.getById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'Utilisateur non trouvé' });
    }
    
    // Ajouter les informations utilisateur à la requête
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

/**
 * Middleware pour vérifier les crédits suffisants
 */
function requireCredits(minCredits = 1) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentification requise' });
    }
    
    if (req.user.credits < minCredits) {
      return res.status(402).json({ 
        error: 'Crédits insuffisants',
        required: minCredits,
        available: req.user.credits
      });
    }
    
    next();
  };
}

/**
 * Middleware de validation des données d'entrée
 */
function validateInput(schema) {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ 
        error: 'Données invalides',
        details: error.details.map(d => d.message)
      });
    }
    next();
  };
}

/**
 * Middleware de logging des activités sensibles
 */
function logSecurityEvent(req, res, next) {
  const originalSend = res.send;
  res.send = function(data) {
    // Log des événements de sécurité
    if (res.statusCode === 401 || res.statusCode === 403) {
      console.warn(`[SECURITY] ${new Date().toISOString()} - ${req.method} ${req.path} - IP: ${req.ip} - Status: ${res.statusCode}`);
    }
    originalSend.call(this, data);
  };
  next();
}

/**
 * Middleware de protection CSRF
 */
function csrfProtection(req, res, next) {
  // Vérifier l'origine de la requête
  const origin = req.get('Origin') || req.get('Referer');
  const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim());
  
  if (req.method !== 'GET' && origin && !allowedOrigins.some(allowed => origin.startsWith(allowed))) {
    return res.status(403).json({ error: 'Origine non autorisée' });
  }
  
  next();
}

module.exports = {
  generateToken,
  verifyToken,
  requireAuth,
  requireCredits,
  validateInput,
  logSecurityEvent,
  csrfProtection,
  loginRateLimit,
  sensitiveRateLimit
};
