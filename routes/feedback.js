// routes/feedback.js - Système de feedback et demandes de fonctionnalités
const express = require('express');
const { sensitiveRateLimit } = require('../middleware/auth');
const Joi = require('joi');
const db = require('../db/sqlite');
const brevo = require('@getbrevo/brevo');

const router = express.Router();

async function sendFeedbackEmailBrevo({ id, type, title, description, email, name, createdAt }) {
  const apiKey = process.env.BREVO_API_KEY;
  const to = process.env.FEEDBACK_MAIL_TO;
  const fromEmail = process.env.FEEDBACK_MAIL_FROM;
  const fromName = process.env.FEEDBACK_MAIL_FROM_NAME || 'Ma Spiritualité';

  if (!apiKey || !to || !fromEmail) return;

  const apiInstance = new brevo.TransactionalEmailsApi();
  apiInstance.setApiKey(brevo.TransactionalEmailsApiApiKeys.apiKey, apiKey);

  const subject = `[Ma Spiritualité] Feedback #${id} — ${type} — ${title}`;

  const textContent =
`Nouveau feedback reçu

ID: ${id}
Date: ${createdAt}
Type: ${type}
Email: ${email || '(non fourni)'}
Nom: ${name || '(non fourni)'}

Titre:
${title}

Description:
${description}
`;

  await apiInstance.sendTransacEmail({
    sender: { email: fromEmail, name: fromName },
    to: [{ email: to }],
    subject,
    textContent,
  });
}


// Préparation des requêtes SQL
const insertFeedback = db.prepare(`
  INSERT INTO feedback (userId, email, name, type, title, description, priority, status, createdAt, updatedAt)
  VALUES (@userId, @email, @name, @type, @title, @description, @priority, @status, @createdAt, @updatedAt)
`);

const getAllFeedback = db.prepare(`
  SELECT 
    f.*,
    CASE WHEN f.userId IS NOT NULL THEN 'Utilisateur connecté' ELSE COALESCE(f.name, 'Anonyme') END as authorName,
    (SELECT COUNT(*) FROM feedback_votes WHERE feedbackId = f.id) as upvotes
  FROM feedback f
  ORDER BY 
    CASE f.priority WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
    upvotes DESC,
    f.createdAt DESC
  LIMIT ? OFFSET ?
`);

const getFeedbackById = db.prepare(`
  SELECT 
    f.*,
    CASE WHEN f.userId IS NOT NULL THEN 'Utilisateur connecté' ELSE COALESCE(f.name, 'Anonyme') END as authorName,
    (SELECT COUNT(*) FROM feedback_votes WHERE feedbackId = f.id) as upvotes
  FROM feedback f
  WHERE f.id = ?
`);

const insertVote = db.prepare(`
  INSERT INTO feedback_votes (feedbackId, userId, createdAt)
  VALUES (@feedbackId, @userId, @createdAt)
`);

const removeVote = db.prepare(`
  DELETE FROM feedback_votes WHERE feedbackId = ? AND userId = ?
`);

const hasUserVoted = db.prepare(`
  SELECT COUNT(*) as count FROM feedback_votes WHERE feedbackId = ? AND userId = ?
`);

const updateFeedbackStatus = db.prepare(`
  UPDATE feedback SET status = @status, updatedAt = @updatedAt WHERE id = @id
`);

const getFeedbackStats = db.prepare(`
  SELECT 
    type,
    COUNT(*) as count,
    status
  FROM feedback
  GROUP BY type, status
`);

// Schémas de validation
const createFeedbackSchema = Joi.object({
  type: Joi.string().valid('feature_request', 'bug_report', 'general_feedback', 'improvement').required(),
  title: Joi.string().min(5).max(200).required(),
  description: Joi.string().min(10).max(2000).required(),
  email: Joi.string().email().optional(),
  name: Joi.string().max(100).optional()
});

const voteSchema = Joi.object({
  feedbackId: Joi.number().integer().positive().required()
});

// GET /api/feedback - Récupérer tous les feedbacks avec pagination
router.get('/', (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;
    const type = req.query.type;
    const status = req.query.status;

    let query = `
      SELECT 
        f.*,
        CASE WHEN f.userId IS NOT NULL THEN 'Utilisateur connecté' ELSE COALESCE(f.name, 'Anonyme') END as authorName,
        (SELECT COUNT(*) FROM feedback_votes WHERE feedbackId = f.id) as upvotes
      FROM feedback f
    `;

    const conditions = [];
    const params = [];

    if (type) {
      conditions.push('f.type = ?');
      params.push(type);
    }

    if (status) {
      conditions.push('f.status = ?');
      params.push(status);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += `
      ORDER BY 
        CASE f.priority WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
        upvotes DESC,
        f.createdAt DESC
      LIMIT ? OFFSET ?
    `;

    params.push(limit, offset);

    const feedbacks = db.prepare(query).all(...params);

    // Compter le total
    let countQuery = 'SELECT COUNT(*) as total FROM feedback f';
    if (conditions.length > 0) {
      countQuery += ' WHERE ' + conditions.join(' AND ');
    }
    const countParams = params.slice(0, -2); // Enlever limit et offset
    const total = db.prepare(countQuery).get(...countParams)?.total || 0;

    res.json({
      feedbacks: feedbacks.map(f => ({
        id: f.id,
        type: f.type,
        title: f.title,
        description: f.description,
        priority: f.priority,
        status: f.status,
        upvotes: f.upvotes,
        authorName: f.authorName,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des feedbacks:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/feedback - Créer un nouveau feedback
router.post('/', sensitiveRateLimit, async (req, res) => {
  try {
    const { error } = createFeedbackSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { type, title, description, email, name } = req.body;
    
    // Récupérer l'utilisateur connecté s'il y en a un
    const authHeader = req.headers.authorization;
    let currentUser = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const { verifyToken } = require('../middleware/auth');
        const decoded = verifyToken(token);
        const users = require('../models/user.repo');
        currentUser = users.getById(decoded.userId);
      } catch (e) {
        // Pas grave si pas connecté
      }
    }

    // Déterminer la priorité automatiquement
    let priority = 'medium';
    if (type === 'bug_report') priority = 'high';
    if (type === 'general_feedback') priority = 'low';

    const result = insertFeedback.run({
      userId: currentUser ? currentUser.id : null,
      email: email || currentUser?.email || null,
      name: name || null,
      type,
      title,
      description,
      priority,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

  // ✅ Envoi email (non bloquant)
    try {
      const createdAt = new Date().toISOString();
      await sendFeedbackEmailBrevo({
        id: Number(result.lastInsertRowid),
        type,
        title,
        description,
        email: email || currentUser?.email || null,
        name: name || null,
        createdAt,
      });
    } catch (e) {
      console.log('⚠️ feedback brevo failed:', e?.message || e);
    }
      
    res.status(201).json({
      id: result.lastInsertRowid,
      message: 'Feedback créé avec succès. Merci pour votre contribution !',
      type,
      title,
      priority
    });

  } catch (error) {
    console.error('Erreur lors de la création du feedback:', error);
    res.status(500).json({ error: 'Erreur lors de la création du feedback' });
  }
});

// GET /api/feedback/:id - Récupérer un feedback spécifique
router.get('/:id', (req, res) => {
  try {
    const feedbackId = parseInt(req.params.id);
    if (isNaN(feedbackId)) {
      return res.status(400).json({ error: 'ID de feedback invalide' });
    }

    const feedback = getFeedbackById.get(feedbackId);
    if (!feedback) {
      return res.status(404).json({ error: 'Feedback non trouvé' });
    }

    res.json({
      id: feedback.id,
      type: feedback.type,
      title: feedback.title,
      description: feedback.description,
      priority: feedback.priority,
      status: feedback.status,
      upvotes: feedback.upvotes,
      authorName: feedback.authorName,
      createdAt: feedback.createdAt,
      updatedAt: feedback.updatedAt
    });

  } catch (error) {
    console.error('Erreur lors de la récupération du feedback:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/feedback/:id/vote - Voter pour un feedback (nécessite d'être connecté)
router.post('/:id/vote', async (req, res) => {
  try {
    const feedbackId = parseInt(req.params.id);
    if (isNaN(feedbackId)) {
      return res.status(400).json({ error: 'ID de feedback invalide' });
    }

    // Vérifier l'authentification
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentification requise pour voter' });
    }

    try {
      const token = authHeader.substring(7);
      const { verifyToken } = require('../middleware/auth');
      const decoded = verifyToken(token);
      const users = require('../models/user.repo');
      const currentUser = users.getById(decoded.userId);
      
      if (!currentUser) {
        return res.status(401).json({ error: 'Utilisateur non trouvé' });
      }

      // Vérifier si le feedback existe
      const feedback = getFeedbackById.get(feedbackId);
      if (!feedback) {
        return res.status(404).json({ error: 'Feedback non trouvé' });
      }

      // Vérifier si l'utilisateur a déjà voté
      const hasVoted = hasUserVoted.get(feedbackId, currentUser.id)?.count > 0;

      if (hasVoted) {
        // Retirer le vote
        removeVote.run(feedbackId, currentUser.id);
        const newUpvotes = feedback.upvotes - 1;
        res.json({
          message: 'Vote retiré',
          upvotes: newUpvotes,
          userHasVoted: false
        });
      } else {
        // Ajouter le vote
        insertVote.run({
          feedbackId,
          userId: currentUser.id,
          createdAt: new Date().toISOString()
        });
        const newUpvotes = feedback.upvotes + 1;
        res.json({
          message: 'Vote ajouté',
          upvotes: newUpvotes,
          userHasVoted: true
        });
      }

    } catch (authError) {
      return res.status(401).json({ error: 'Token invalide' });
    }

  } catch (error) {
    console.error('Erreur lors du vote:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/feedback/stats/overview - Statistiques des feedbacks
router.get('/stats/overview', (req, res) => {
  try {
    const stats = getFeedbackStats.all();
    
    // Organiser les statistiques
    const overview = {
      total: 0,
      byType: {},
      byStatus: {},
      byTypeAndStatus: {}
    };

    stats.forEach(stat => {
      overview.total += stat.count;
      
      if (!overview.byType[stat.type]) {
        overview.byType[stat.type] = 0;
      }
      overview.byType[stat.type] += stat.count;
      
      if (!overview.byStatus[stat.status]) {
        overview.byStatus[stat.status] = 0;
      }
      overview.byStatus[stat.status] += stat.count;
      
      if (!overview.byTypeAndStatus[stat.type]) {
        overview.byTypeAndStatus[stat.type] = {};
      }
      overview.byTypeAndStatus[stat.type][stat.status] = stat.count;
    });

    res.json(overview);
  } catch (error) {
    console.error('Erreur lors de la récupération des stats:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/feedback/roadmap - Feuille de route publique
router.get('/roadmap', (req, res) => {
  try {
    const roadmapItems = db.prepare(`
      SELECT 
        f.*,
        (SELECT COUNT(*) FROM feedback_votes WHERE feedbackId = f.id) as upvotes
      FROM feedback f
      WHERE f.type = 'feature_request' 
        AND f.status IN ('planned', 'in_progress', 'completed')
      ORDER BY 
        CASE f.status 
          WHEN 'in_progress' THEN 1 
          WHEN 'planned' THEN 2 
          WHEN 'completed' THEN 3 
          ELSE 4 
        END,
        upvotes DESC,
        f.createdAt DESC
      LIMIT 20
    `).all();

    const roadmap = {
      in_progress: [],
      planned: [],
      completed: []
    };

    roadmapItems.forEach(item => {
      roadmap[item.status].push({
        id: item.id,
        title: item.title,
        description: item.description,
        upvotes: item.upvotes,
        priority: item.priority,
        updatedAt: item.updatedAt
      });
    });

    res.json(roadmap);
  } catch (error) {
    console.error('Erreur lors de la récupération de la roadmap:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;