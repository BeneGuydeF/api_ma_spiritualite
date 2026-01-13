// db/sqlite.js
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Fichier DB persistant (sauvegardé sur disque)
const envDbPath = process.env.SQLITE_PATH;
const dbPath = envDbPath
  ? path.resolve(envDbPath)
  : path.join(DATA_DIR, 'ma_spiritualite.db');

console.log('[SQLite] Using DB at:', dbPath);

const db = new Database(dbPath);

// Initialisation des tables si besoin
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  name TEXT,
  age_bucket TEXT,
  theme TEXT DEFAULT 'system',
  analytics INTEGER DEFAULT 0,
  credits INTEGER DEFAULT 7,
  encryptionSalt TEXT,
  secretQuestion TEXT,
  secretAnswerHash TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER,
  email TEXT,
  amount INTEGER NOT NULL,
  message TEXT,
  anonymous BOOLEAN DEFAULT FALSE,
  provider TEXT NOT NULL CHECK (provider IN ('stripe', 'paypal')),
  sessionId TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  createdAt TEXT NOT NULL,
  completedAt TEXT,
  FOREIGN KEY (userId) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER,
  email TEXT,
  name TEXT,
  type TEXT NOT NULL CHECK (type IN ('feature_request', 'bug_report', 'general_feedback', 'improvement')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'planned', 'in_progress', 'completed', 'rejected')),
  upvotes INTEGER DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS feedback_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feedbackId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (feedbackId) REFERENCES feedback(id),
  FOREIGN KEY (userId) REFERENCES users(id),
  UNIQUE(feedbackId, userId)
);
CREATE TABLE IF NOT EXISTS ia_cache (
  cache_key TEXT PRIMARY KEY,
  response  TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ia_cache_updated ON ia_cache(updated_at);

`);

module.exports = db;
