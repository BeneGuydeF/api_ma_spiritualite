// models/journal.repo.js - Gestion du carnet spirituel chiffré
const db = require('../db/sqlite');

const insertEntry = db.prepare(`
  INSERT INTO journal_entries (userId, title, encryptedContent, encryptedTags, iv, createdAt, updatedAt)
  VALUES (@userId, @title, @encryptedContent, @encryptedTags, @iv, @createdAt, @updatedAt)
`);

const updateEntry = db.prepare(`
  UPDATE journal_entries 
  SET title = @title, encryptedContent = @encryptedContent, encryptedTags = @encryptedTags, iv = @iv, updatedAt = @updatedAt
  WHERE id = @id AND userId = @userId
`);

const deleteEntry = db.prepare(`
  DELETE FROM journal_entries WHERE id = ? AND userId = ?
`);

const findByIdAndUser = db.prepare(`
  SELECT * FROM journal_entries WHERE id = ? AND userId = ?
`);

const findByUser = db.prepare(`
  SELECT id, userId, title, iv, createdAt, updatedAt
  FROM journal_entries 
  WHERE userId = ? 
  ORDER BY createdAt DESC 
  LIMIT ? OFFSET ?
`);

const countByUser = db.prepare(`
  SELECT COUNT(*) as total FROM journal_entries WHERE userId = ?
`);

const findByUserWithContent = db.prepare(`
  SELECT * FROM journal_entries WHERE id = ? AND userId = ?
`);

module.exports = {
  // Créer une nouvelle entrée
  create: (entry) => {
    return insertEntry.run({
      ...entry,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  },

  // Mettre à jour une entrée existante
  update: (id, userId, entry) => {
    return updateEntry.run({
      ...entry,
      id,
      userId,
      updatedAt: new Date().toISOString()
    });
  },

  // Supprimer une entrée
  delete: (id, userId) => {
    const result = deleteEntry.run(id, userId);
    return result.changes > 0;
  },

  // Récupérer une entrée spécifique avec son contenu
  getById: (id, userId) => {
    return findByIdAndUser.get(id, userId);
  },

  // Récupérer les entrées d'un utilisateur (sans contenu pour la liste)
  getByUser: (userId, limit = 20, offset = 0) => {
    return findByUser.all(userId, limit, offset);
  },

  // Récupérer une entrée avec son contenu chiffré
  getWithContent: (id, userId) => {
    return findByUserWithContent.get(id, userId);
  },

  // Compter le nombre total d'entrées d'un utilisateur
  countByUser: (userId) => {
    const result = countByUser.get(userId);
    return result?.total || 0;
  },

  // Recherche dans les titres (non chiffrés)
  searchByTitle: (userId, searchTerm, limit = 20) => {
    const searchQuery = db.prepare(`
      SELECT id, userId, title, iv, createdAt, updatedAt
      FROM journal_entries 
      WHERE userId = ? AND title LIKE ?
      ORDER BY createdAt DESC 
      LIMIT ?
    `);
    
    return searchQuery.all(userId, `%${searchTerm}%`, limit);
  },

  // Statistiques pour l'utilisateur
  getStats: (userId) => {
    const totalEntries = countByUser.get(userId)?.total || 0;
    
    const recentCount = db.prepare(`
      SELECT COUNT(*) as recent FROM journal_entries 
      WHERE userId = ? AND createdAt >= datetime('now', '-7 days')
    `).get(userId)?.recent || 0;

    const thisMonthCount = db.prepare(`
      SELECT COUNT(*) as thisMonth FROM journal_entries 
      WHERE userId = ? AND createdAt >= datetime('now', 'start of month')
    `).get(userId)?.thisMonth || 0;

    return {
      totalEntries,
      recentEntries: recentCount,
      thisMonthEntries: thisMonthCount
    };
  }
};