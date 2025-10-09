// routes/journal.js - API du carnet spirituel chiffré
const express = require('express');
const { requireAuth, requireCredits, sensitiveRateLimit } = require('../middleware/auth');
const { encrypt, decrypt, encryptJSON, decryptJSON } = require('../utils/crypto');
const journal = require('../models/journal.repo');
const credits = require('../models/credits.repo');
const Joi = require('joi');

const router = express.Router();

// Appliquer l'authentification à toutes les routes
router.use(requireAuth);

// Schémas de validation
const createEntrySchema = Joi.object({
  title: Joi.string().min(1).max(200).required(),
  content: Joi.string().min(1).max(50000).required(),
  tags: Joi.array().items(Joi.string().max(50)).max(20).optional(),
  password: Joi.string().min(1).required() // Mot de passe pour le chiffrement
});

const updateEntrySchema = Joi.object({
  title: Joi.string().min(1).max(200).optional(),
  content: Joi.string().min(1).max(50000).optional(),
  tags: Joi.array().items(Joi.string().max(50)).max(20).optional(),
  password: Joi.string().min(1).required()
});

const unlockEntrySchema = Joi.object({
  password: Joi.string().min(1).required()
});

// GET /api/journal - Récupérer la liste des entrées (sans contenu)
router.get('/', (req, res) => {
  try {
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const entries = journal.getByUser(userId, limit, offset);
    const total = journal.countByUser(userId);
    const stats = journal.getStats(userId);

    res.json({
      entries,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      },
      stats
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des entrées:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/journal - Créer une nouvelle entrée (gratuit)
router.post('/', sensitiveRateLimit, async (req, res) => {
  try {
    const { error } = createEntrySchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { title, content, tags = [], password } = req.body;
    const userId = req.user.id;

    if (!req.user.encryptionSalt) {
      return res.status(400).json({ error: 'Sel de chiffrement non initialisé' });
    }

    // Chiffrer le contenu
    const encryptedContent = encrypt(content, password, req.user.encryptionSalt);
    
    // Chiffrer les tags si présents
    let encryptedTags = null;
    if (tags.length > 0) {
      encryptedTags = encryptJSON(tags, password, req.user.encryptionSalt);
    }

    // Créer l'entrée
    const result = journal.create({
      userId,
      title,
      encryptedContent: JSON.stringify(encryptedContent),
      encryptedTags: encryptedTags ? JSON.stringify(encryptedTags) : null,
      iv: encryptedContent.iv
    });

    res.status(201).json({
      id: result.lastInsertRowid,
      title,
      createdAt: new Date().toISOString(),
      message: 'Entrée créée avec succès'
    });

  } catch (error) {
    console.error('Erreur lors de la création de l\'entrée:', error);
    res.status(500).json({ error: 'Erreur lors de la création de l\'entrée' });
  }
});

// GET /api/journal/:id - Récupérer une entrée spécifique (métadonnées seulement)
router.get('/:id', (req, res) => {
  try {
    const entryId = parseInt(req.params.id);
    const userId = req.user.id;

    if (isNaN(entryId)) {
      return res.status(400).json({ error: 'ID d\'entrée invalide' });
    }

    const entry = journal.getById(entryId, userId);
    if (!entry) {
      return res.status(404).json({ error: 'Entrée non trouvée' });
    }

    // Retourner seulement les métadonnées
    res.json({
      id: entry.id,
      title: entry.title,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      encrypted: true
    });

  } catch (error) {
    console.error('Erreur lors de la récupération de l\'entrée:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/journal/:id/unlock - Déchiffrer et récupérer le contenu d'une entrée
router.post('/:id/unlock', (req, res) => {
  try {
    const { error } = unlockEntrySchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const entryId = parseInt(req.params.id);
    const userId = req.user.id;
    const { password } = req.body;

    if (isNaN(entryId)) {
      return res.status(400).json({ error: 'ID d\'entrée invalide' });
    }

    const entry = journal.getWithContent(entryId, userId);
    if (!entry) {
      return res.status(404).json({ error: 'Entrée non trouvée' });
    }

    try {
      // Déchiffrer le contenu
      const encryptedData = JSON.parse(entry.encryptedContent);
      const content = decrypt(
        encryptedData.encryptedData,
        encryptedData.iv,
        encryptedData.tag,
        password,
        req.user.encryptionSalt
      );

      // Déchiffrer les tags si présents
      let tags = [];
      if (entry.encryptedTags) {
        const encryptedTagsData = JSON.parse(entry.encryptedTags);
        tags = decryptJSON(
          encryptedTagsData.encryptedData,
          encryptedTagsData.iv,
          encryptedTagsData.tag,
          password,
          req.user.encryptionSalt
        );
      }

      res.json({
        id: entry.id,
        title: entry.title,
        content,
        tags,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt
      });

    } catch (decryptError) {
      return res.status(401).json({ error: 'Mot de passe incorrect' });
    }

  } catch (error) {
    console.error('Erreur lors du déchiffrement de l\'entrée:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/journal/:id - Mettre à jour une entrée
router.put('/:id', sensitiveRateLimit, async (req, res) => {
  try {
    const { error } = updateEntrySchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const entryId = parseInt(req.params.id);
    const userId = req.user.id;
    const { title, content, tags, password } = req.body;

    if (isNaN(entryId)) {
      return res.status(400).json({ error: 'ID d\'entrée invalide' });
    }

    const existingEntry = journal.getById(entryId, userId);
    if (!existingEntry) {
      return res.status(404).json({ error: 'Entrée non trouvée' });
    }

    const updateData = {};

    // Mettre à jour le titre si fourni
    if (title !== undefined) {
      updateData.title = title;
    }

    // Chiffrer et mettre à jour le contenu si fourni
    if (content !== undefined) {
      const encryptedContent = encrypt(content, password, req.user.encryptionSalt);
      updateData.encryptedContent = JSON.stringify(encryptedContent);
      updateData.iv = encryptedContent.iv;
    }

    // Chiffrer et mettre à jour les tags si fournis
    if (tags !== undefined) {
      if (tags.length > 0) {
        const encryptedTags = encryptJSON(tags, password, req.user.encryptionSalt);
        updateData.encryptedTags = JSON.stringify(encryptedTags);
      } else {
        updateData.encryptedTags = null;
      }
    }

    const result = journal.update(entryId, userId, updateData);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Entrée non trouvée ou non modifiée' });
    }

    res.json({ 
      message: 'Entrée mise à jour avec succès',
      updatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Erreur lors de la mise à jour de l\'entrée:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour' });
  }
});

// DELETE /api/journal/:id - Supprimer une entrée
router.delete('/:id', sensitiveRateLimit, (req, res) => {
  try {
    const entryId = parseInt(req.params.id);
    const userId = req.user.id;

    if (isNaN(entryId)) {
      return res.status(400).json({ error: 'ID d\'entrée invalide' });
    }

    const deleted = journal.delete(entryId, userId);
    if (!deleted) {
      return res.status(404).json({ error: 'Entrée non trouvée' });
    }

    res.json({ message: 'Entrée supprimée avec succès' });

  } catch (error) {
    console.error('Erreur lors de la suppression de l\'entrée:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/journal/search - Recherche dans les titres
router.get('/search', (req, res) => {
  try {
    const userId = req.user.id;
    const { q: query, limit = 20 } = req.query;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: 'Terme de recherche requis' });
    }

    const entries = journal.searchByTitle(userId, query.trim(), Math.min(50, parseInt(limit)));

    res.json({
      query: query.trim(),
      results: entries
    });

  } catch (error) {
    console.error('Erreur lors de la recherche:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;