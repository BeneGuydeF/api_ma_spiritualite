// models/user.repo.js (CommonJS)
const db = require('../db/sqlite');
const { generateSalt } = require('../utils/crypto');

// ===========================
// PREPARED STATEMENTS
// ===========================

// INSERT user
const insertUser = db.prepare(`
  INSERT INTO users (
    email,
    passwordHash,
    age_bucket,
    secretQuestion,
    secretAnswerHash,
    credits,
    encryptionSalt,
    createdAt,
    updatedAt
  )
  VALUES (
    @email,
    @passwordHash,
    @age_bucket,
    @secretQuestion,
    @secretAnswerHash,
    @credits,
    @encryptionSalt,
    @createdAt,
    @updatedAt
  )
`);

// SELECT user
const findByEmail = db.prepare(`SELECT * FROM users WHERE email = ?`);
const findById = db.prepare(`SELECT * FROM users WHERE id = ?`);

// UPDATE password
const updatePassword = db.prepare(`
  UPDATE users
  SET passwordHash = @passwordHash,
      updatedAt   = @updatedAt
  WHERE email = @email
`);

// UPDATE credits
const updateCredits = db.prepare(`
  UPDATE users
  SET credits   = @credits,
      updatedAt = @updatedAt
  WHERE id = @userId
`);

// UPDATE encryption salt
const updateEncryptionSalt = db.prepare(`
  UPDATE users
  SET encryptionSalt = @encryptionSalt,
      updatedAt      = @updatedAt
  WHERE id = @userId
`);


// ===========================
// EXPORTED REPO
// ===========================

module.exports = {
  // Create user
  create: (user) => {
    const now = new Date().toISOString();

    const userData = {
      email: user.email,
      passwordHash: user.passwordHash,
      age_bucket: user.age_bucket ?? null,
      secretQuestion: user.secretQuestion ?? null,
      secretAnswerHash: user.secretAnswerHash ?? null,
      credits: user.credits ?? 5, // crédits gratuits
      encryptionSalt: generateSalt(),
      createdAt: now,
      updatedAt: now
    };

    return insertUser.run(userData);
  },

  // Getters
  getByEmail: (email) => findByEmail.get(email),
  getById: (id) => findById.get(id),

  // Update password
  setPassword: ({ email, passwordHash }) =>
    updatePassword.run({
      email,
      passwordHash,
      updatedAt: new Date().toISOString()
    }),

  // Update credits
  updateCredits: ({ userId, credits }) =>
    updateCredits.run({
      userId,
      credits,
      updatedAt: new Date().toISOString()
    }),

  // Update encryption salt
  setEncryptionSalt: ({ userId, encryptionSalt }) =>
    updateEncryptionSalt.run({
      userId,
      encryptionSalt,
      updatedAt: new Date().toISOString()
    }),
};
