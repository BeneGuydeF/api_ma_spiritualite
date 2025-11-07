// scripts/migrate.js - Migration complète (version bêta stable)
const Database = require('better-sqlite3');
const path = require('path');
const { generateSalt } = require('../utils/crypto');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const dbPath = path.join(DATA_DIR, 'ma_spiritualite.db');

console.log('🔧 Migration complète de la base de données Ma Spiritualité...');

// Assurer le dossier data
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const db = new Database(dbPath);

try {
  // === TABLE UTILISATEURS ===
  const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);

  if (!userCols.includes('credits')) {
    console.log('➕ Ajout colonne credits à users...');
    db.exec(`ALTER TABLE users ADD COLUMN credits INTEGER DEFAULT 5`);
  }

  if (!userCols.includes('encryptionSalt')) {
    console.log('➕ Ajout colonne encryptionSalt à users...');
    db.exec(`ALTER TABLE users ADD COLUMN encryptionSalt TEXT`);
  }

  // === CARNET NON CHIFFRÉ (mode sans crédits) ===
  db.exec(`
    CREATE TABLE IF NOT EXISTS carnet_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      titre TEXT NOT NULL,
      contenu TEXT NOT NULL,
      rubrique TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_carnet_user_created
      ON carnet_entries(user_id, created_at DESC);
  `);

  // === CARNET CHIFFRÉ AES (journal sécurisé) ===
 db.exec(`
  CREATE TABLE IF NOT EXISTS journal_entries_secure (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    encryptedContent TEXT NOT NULL,
    encryptedTags TEXT,
    iv TEXT NOT NULL,
    tag TEXT NOT NULL, -- AuthTag pour AES-GCM
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_secure_user_created
    ON journal_entries_secure(user_id, created_at DESC);
`);

  // === TRANSACTIONS DE CRÉDITS ===
  db.exec(`
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
  `);

  // === PAIEMENTS ===
  db.exec(`
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

  // === DONATIONS ===
  db.exec(`
    CREATE TABLE IF NOT EXISTS donations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER,
      amount REAL NOT NULL,
      message TEXT,
      provider TEXT CHECK (provider IN ('stripe', 'paypal', 'autre')),
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id)
    );
  `);

  // === INITIALISATION DES UTILISATEURS ===
  const usersWithoutSalt = db.prepare('SELECT id FROM users WHERE encryptionSalt IS NULL').all();
  const updateSalt = db.prepare('UPDATE users SET encryptionSalt = ? WHERE id = ?');
  for (const user of usersWithoutSalt) {
    updateSalt.run(generateSalt(), user.id);
  }

  const usersWithoutCredits = db.prepare('SELECT id FROM users WHERE credits IS NULL OR credits = 0').all();
  const updateCredits = db.prepare('UPDATE users SET credits = 5 WHERE id = ?');
  for (const user of usersWithoutCredits) {
    updateCredits.run(user.id);
  }

  console.log(`✅ Migration terminée avec succès.`);
  console.log(`   - carnet_entries (non chiffré)`);
  console.log(`   - journal_entries_secure (AES-256)`);
  console.log(`   - credit_transactions / payment_sessions / donations`);
  console.log(`   - users.credits + users.encryptionSalt`);

} catch (err) {
  console.error('❌ Erreur lors de la migration:', err);
  process.exit(1);
} finally {
  db.close();
}
