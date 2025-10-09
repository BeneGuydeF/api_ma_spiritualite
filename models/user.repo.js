// models/user.repo.js (CommonJS)
const db = require('../db/sqlite');
const { generateSalt } = require('../utils/crypto');

const insertUser = db.prepare(`
  INSERT INTO users (email, passwordHash, ageBucket, secretQuestion, secretAnswerHash, credits, encryptionSalt, createdAt, updatedAt)
  VALUES (@email, @passwordHash, @ageBucket, @secretQuestion, @secretAnswerHash, @credits, @encryptionSalt, @createdAt, @updatedAt)
`);

const findByEmail = db.prepare(`SELECT * FROM users WHERE email = ?`);
const findById = db.prepare(`SELECT * FROM users WHERE id = ?`);

const updatePassword = db.prepare(`
  UPDATE users SET passwordHash = @passwordHash, updatedAt = @updatedAt WHERE email = @email
`);

const updateCredits = db.prepare(`
  UPDATE users SET credits = @credits, updatedAt = @updatedAt WHERE id = @userId
`);

const updateEncryptionSalt = db.prepare(`
  UPDATE users SET encryptionSalt = @encryptionSalt, updatedAt = @updatedAt WHERE id = @userId
`);

module.exports = {
  create: (user) => {
    const userData = {
      ...user,
      credits: user.credits || 5, // 5 crédits gratuits à l'inscription
      encryptionSalt: generateSalt()
    };
    return insertUser.run(userData);
  },
  
  getByEmail: (email) => findByEmail.get(email),
  getById: (id) => findById.get(id),
  
  setPassword: ({ email, passwordHash }) =>
    updatePassword.run({ email, passwordHash, updatedAt: new Date().toISOString() }),
    
  updateCredits: ({ userId, credits }) =>
    updateCredits.run({ userId, credits, updatedAt: new Date().toISOString() }),
    
  setEncryptionSalt: ({ userId, encryptionSalt }) =>
    updateEncryptionSalt.run({ userId, encryptionSalt, updatedAt: new Date().toISOString() }),
};
