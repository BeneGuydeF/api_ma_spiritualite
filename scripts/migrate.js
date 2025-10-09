// scripts/migrate.js - Script de migration de la base de données
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const dbPath = path.join(DATA_DIR, 'ma_spiritualite.db');

console.log('🔧 Début de la migration de la base de données...');

// Ouvrir la connexion à la base
const db = new Database(dbPath);

try {
  // Vérifier les colonnes existantes dans la table users
  const tableInfo = db.prepare("PRAGMA table_info(users)").all();
  const existingColumns = tableInfo.map(col => col.name);
  
  console.log('📋 Colonnes existantes:', existingColumns);
  
  // Ajouter les colonnes manquantes si elles n'existent pas
  if (!existingColumns.includes('credits')) {
    console.log('➕ Ajout de la colonne credits...');
    db.exec('ALTER TABLE users ADD COLUMN credits INTEGER DEFAULT 5');
  }
  
  if (!existingColumns.includes('encryptionSalt')) {
    console.log('➕ Ajout de la colonne encryptionSalt...');
    db.exec('ALTER TABLE users ADD COLUMN encryptionSalt TEXT');
  }
  
  // Créer les nouvelles tables si elles n'existent pas
  console.log('📝 Création des nouvelles tables...');
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS journal_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      title TEXT,
      encryptedContent TEXT NOT NULL,
      encryptedTags TEXT,
      iv TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    );
    
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('purchase', 'usage', 'refund')),
      description TEXT,
      paymentMethod TEXT,
      paymentId TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    );
    
    CREATE TABLE IF NOT EXISTS payment_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      sessionId TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL CHECK (provider IN ('stripe', 'paypal')),
      amount INTEGER NOT NULL,
      credits INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      createdAt TEXT NOT NULL,
      completedAt TEXT,
      FOREIGN KEY (userId) REFERENCES users(id)
    );
  `);
  
  // Mettre à jour les utilisateurs existants pour leur donner des crédits et un salt de chiffrement
  const { generateSalt } = require('../utils/crypto');
  const usersWithoutSalt = db.prepare('SELECT id FROM users WHERE encryptionSalt IS NULL').all();
  
  if (usersWithoutSalt.length > 0) {
    console.log(`🔑 Génération des sels de chiffrement pour ${usersWithoutSalt.length} utilisateur(s)...`);
    
    const updateUserSalt = db.prepare('UPDATE users SET encryptionSalt = ? WHERE id = ?');
    
    for (const user of usersWithoutSalt) {
      const salt = generateSalt();
      updateUserSalt.run(salt, user.id);
    }
  }
  
  // Mettre à jour les crédits pour les utilisateurs existants s'ils n'en ont pas
  const usersWithoutCredits = db.prepare('SELECT id FROM users WHERE credits = 0 OR credits IS NULL').all();
  
  if (usersWithoutCredits.length > 0) {
    console.log(`💰 Attribution de 5 crédits gratuits à ${usersWithoutCredits.length} utilisateur(s)...`);
    
    const updateUserCredits = db.prepare('UPDATE users SET credits = 5 WHERE id = ?');
    
    for (const user of usersWithoutCredits) {
      updateUserCredits.run(user.id);
    }
  }
  
  console.log('✅ Migration terminée avec succès !');
  
} catch (error) {
  console.error('❌ Erreur lors de la migration:', error);
  process.exit(1);
} finally {
  db.close();
}