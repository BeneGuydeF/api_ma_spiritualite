// models/credits.repo.js - Gestion des crédits utilisateur
const db = require('../db/sqlite');

// Transactions de crédits
const insertTransaction = db.prepare(`
  INSERT INTO credit_transactions (userId, amount, type, description, paymentMethod, paymentId, createdAt)
  VALUES (@userId, @amount, @type, @description, @paymentMethod, @paymentId, @createdAt)
`);

const getTransactionsByUser = db.prepare(`
  SELECT * FROM credit_transactions 
  WHERE userId = ? 
  ORDER BY createdAt DESC 
  LIMIT ?
`);

const getTotalCreditsUsed = db.prepare(`
  SELECT SUM(amount) as total FROM credit_transactions 
  WHERE userId = ? AND type = 'usage'
`);

// Sessions de paiement
const insertPaymentSession = db.prepare(`
  INSERT INTO payment_sessions (userId, sessionId, provider, amount, credits, status, createdAt)
  VALUES (@userId, @sessionId, @provider, @amount, @credits, @status, @createdAt)
`);

const getPaymentSession = db.prepare(`
  SELECT * FROM payment_sessions WHERE sessionId = ?
`);

const updatePaymentSession = db.prepare(`
  UPDATE payment_sessions 
  SET status = @status, completedAt = @completedAt 
  WHERE sessionId = @sessionId
`);

const getPaymentSessionsByUser = db.prepare(`
  SELECT * FROM payment_sessions 
  WHERE userId = ? 
  ORDER BY createdAt DESC 
  LIMIT ?
`);

// Prix des crédits (en centimes) - Positionnement familles catholiques CSP+
const CREDIT_PRICES = {
  20: 300,   // 20 crédits = 3€ (0,15€/crédit)
  45: 700,   // 45 crédits = 7€ (0,15€/crédit)  
  100: 1500   // 100 crédits = 15€ (0,15€/crédit - meilleur prix)
};

module.exports = {
  // Transactions
  createTransaction: (transaction) => {
    return insertTransaction.run({
      ...transaction,
      createdAt: new Date().toISOString()
    });
  },
  
  getTransactionsByUser: (userId, limit = 50) => 
    getTransactionsByUser.all(userId, limit),
    
  getTotalCreditsUsed: (userId) => {
    const result = getTotalCreditsUsed.get(userId);
    return result?.total || 0;
  },
  
  // Sessions de paiement
  createPaymentSession: (session) => {
    return insertPaymentSession.run({
      ...session,
      status: 'pending',
      createdAt: new Date().toISOString()
    });
  },
  
  getPaymentSession: (sessionId) => getPaymentSession.get(sessionId),
  
  updatePaymentSession: (sessionId, status) => {
    return updatePaymentSession.run({
      sessionId,
      status,
      completedAt: status === 'completed' ? new Date().toISOString() : null
    });
  },
  
  getPaymentSessionsByUser: (userId, limit = 20) =>
    getPaymentSessionsByUser.all(userId, limit),
  
  // Fonctions utilitaires
  getCreditPrice: (credits) => CREDIT_PRICES[credits] || null,
  
  getAvailableCreditPackages: () => Object.keys(CREDIT_PRICES).map(credits => ({
    credits: parseInt(credits),
    price: CREDIT_PRICES[credits],
    priceFormatted: `${(CREDIT_PRICES[credits] / 100).toFixed(2)}€`
  })),
  
  // Déduction de crédits avec vérification
  deductCredits: (userId, amount, description = 'Usage') => {
    const users = require('./user.repo');
    const user = users.getById(userId);
    
    if (!user || user.credits < amount) {
      throw new Error('Crédits insuffisants');
    }
    
    const newCredits = user.credits - amount;
    
    // Transaction atomique
    db.transaction(() => {
      users.updateCredits({ userId, credits: newCredits });
      insertTransaction.run({
        userId,
        amount: -amount,
        type: 'usage',
        description,
        paymentMethod: null,
        paymentId: null,
        createdAt: new Date().toISOString()
      });
    })();
    
    return newCredits;
  },
  
  // Ajout de crédits
  addCredits: (userId, amount, paymentMethod, paymentId, description = 'Achat de crédits') => {
    const users = require('./user.repo');
    const user = users.getById(userId);
    
    if (!user) {
      throw new Error('Utilisateur non trouvé');
    }
    
    const newCredits = user.credits + amount;
    
    // Transaction atomique
    db.transaction(() => {
      users.updateCredits({ userId, credits: newCredits });
      insertTransaction.run({
        userId,
        amount,
        type: 'purchase',
        description,
        paymentMethod,
        paymentId,
        createdAt: new Date().toISOString()
      });
    })();
    
    return newCredits;
  }
};