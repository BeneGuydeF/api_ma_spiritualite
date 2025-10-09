// routes/donations.js - Système de dons libres pour soutenir le développement
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { sensitiveRateLimit } = require('../middleware/auth');
const Joi = require('joi');
const db = require('../db/sqlite');

const router = express.Router();

// Préparation des requêtes SQL
const insertDonation = db.prepare(`
  INSERT INTO donations (userId, email, amount, message, anonymous, provider, sessionId, status, createdAt)
  VALUES (@userId, @email, @amount, @message, @anonymous, @provider, @sessionId, @status, @createdAt)
`);

const updateDonationStatus = db.prepare(`
  UPDATE donations SET status = @status, completedAt = @completedAt WHERE sessionId = @sessionId
`);

const getRecentDonations = db.prepare(`
  SELECT 
    amount, 
    message,
    'Donateur généreux' as donorName,
    createdAt
  FROM donations 
  WHERE status = 'completed' AND message IS NOT NULL AND message != ''
  ORDER BY createdAt DESC 
  LIMIT ?
`);

const getDonationStats = db.prepare(`
  SELECT 
    COUNT(*) as totalDonations,
    SUM(amount) as totalAmount,
    AVG(amount) as averageAmount
  FROM donations 
  WHERE status = 'completed'
`);

// Schémas de validation
const createDonationSchema = Joi.object({
  amount: Joi.number().min(100).max(50000).required(), // 1€ à 500€ en centimes
  message: Joi.string().max(500).optional().allow(''),
  email: Joi.string().email().optional(),
  name: Joi.string().max(100).optional(),
  anonymous: Joi.boolean().default(false),
  provider: Joi.string().valid('stripe', 'paypal').required()
});

// GET /api/donations/stats - Statistiques publiques des dons
router.get('/stats', (req, res) => {
  try {
    const stats = getDonationStats.get();
    const recentDonations = getRecentDonations.all(10);
    
    res.json({
      stats: {
        totalDonations: stats?.totalDonations || 0,
        totalAmount: stats?.totalAmount || 0,
        averageAmount: Math.round(stats?.averageAmount || 0),
        totalAmountFormatted: `${((stats?.totalAmount || 0) / 100).toFixed(2)}€`
      },
      recentDonations: recentDonations.map(d => ({
        amount: d.amount,
        amountFormatted: `${(d.amount / 100).toFixed(2)}€`,
        message: d.message,
        donorName: d.donorName,
        createdAt: d.createdAt
      }))
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des stats:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/donations/create - Créer une session de don
router.post('/create', sensitiveRateLimit, async (req, res) => {
  try {
    const { error } = createDonationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { amount, message, email, name, anonymous, provider } = req.body;
    
    // Récupérer l'utilisateur connecté s'il y en a un
    const authHeader = req.headers.authorization;
    let currentUser = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const { requireAuth } = require('../middleware/auth');
        // Simuler une vérification d'auth sans faire échouer
        const token = authHeader.substring(7);
        const { verifyToken } = require('../middleware/auth');
        const decoded = verifyToken(token);
        const users = require('../models/user.repo');
        currentUser = users.getById(decoded.userId);
      } catch (e) {
        // Pas grave si pas connecté pour un don
      }
    }

    if (provider === 'stripe') {
      // Créer une session Stripe Checkout pour le don
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'eur',
            product_data: {
              name: 'Don de soutien - Ma Spiritualité',
              description: 'Soutenez le développement de l\'application Ma Spiritualité pour aider les familles catholiques dans leur cheminement de foi.'
            },
            unit_amount: amount,
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: `${process.env.FRONTEND_URL}/donation/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL}/donation/cancel`,
        metadata: {
          userId: currentUser ? currentUser.id.toString() : '',
          email: email || currentUser?.email || '',
          name: name || '',
          message: message || '',
          anonymous: anonymous.toString(),
          provider: 'stripe'
        },
        expires_at: Math.floor(Date.now() / 1000) + (30 * 60) // 30 minutes
      });

      // Sauvegarder le don en base
      insertDonation.run({
        userId: currentUser ? currentUser.id : null,
        email: email || currentUser?.email || null,
        amount,
        message: message || null,
        anonymous: anonymous ? 1 : 0,
        provider: 'stripe',
        sessionId: session.id,
        status: 'pending',
        createdAt: new Date().toISOString()
      });

      res.json({
        sessionId: session.id,
        url: session.url,
        provider: 'stripe'
      });

    } else if (provider === 'paypal') {
      const sessionId = `paypal_donation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      insertDonation.run({
        userId: currentUser ? currentUser.id : null,
        email: email || currentUser?.email || null,
        amount,
        message: message || null,
        anonymous: anonymous ? 1 : 0,
        provider: 'paypal',
        sessionId,
        status: 'pending',
        createdAt: new Date().toISOString()
      });

      res.json({
        sessionId,
        amount,
        provider: 'paypal',
        paypalConfig: {
          clientId: process.env.PAYPAL_CLIENT_ID,
          currency: 'EUR',
          amount: (amount / 100).toString()
        }
      });
    }

  } catch (error) {
    console.error('Erreur lors de la création du don:', error);
    res.status(500).json({ error: 'Erreur lors de la création du don' });
  }
});

// POST /api/donations/stripe/webhook - Webhook Stripe pour confirmer les dons
router.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Erreur de vérification webhook Stripe:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    
    try {
      // Mettre à jour le statut du don
      updateDonationStatus.run({
        sessionId: session.id,
        status: 'completed',
        completedAt: new Date().toISOString()
      });

      console.log(`Don confirmé: ${session.amount_total / 100}€ - Session: ${session.id}`);
    } catch (error) {
      console.error('Erreur lors du traitement du don:', error);
    }
  }

  res.json({ received: true });
});

// POST /api/donations/paypal/confirm - Confirmer un don PayPal
router.post('/paypal/confirm', async (req, res) => {
  try {
    const { sessionId, paypalOrderId } = req.body;
    
    if (!sessionId || !paypalOrderId) {
      return res.status(400).json({ error: 'Session ID et Order ID PayPal requis' });
    }

    // Ici vous devriez vérifier le paiement avec l'API PayPal
    // Pour la démonstration, on considère que le paiement est valide
    
    updateDonationStatus.run({
      sessionId,
      status: 'completed',
      completedAt: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Don confirmé avec succès. Merci pour votre soutien !'
    });

  } catch (error) {
    console.error('Erreur lors de la confirmation PayPal:', error);
    res.status(500).json({ error: 'Erreur lors de la confirmation du don' });
  }
});

// GET /api/donations/leaderboard - Classement des donateurs (anonymisé)
router.get('/leaderboard', (req, res) => {
  try {
    const topDonors = db.prepare(`
      SELECT 
        'Donateur généreux' as donorName,
        SUM(amount) as totalAmount,
        COUNT(*) as donationCount
      FROM donations 
      WHERE status = 'completed'
      GROUP BY CASE WHEN anonymous = 1 THEN 'anonymous' ELSE COALESCE(userId, email) END
      ORDER BY totalAmount DESC
      LIMIT 10
    `).all();

    res.json({
      topDonors: topDonors.map((donor, index) => ({
        rank: index + 1,
        name: donor.donorName,
        totalAmount: donor.totalAmount,
        totalAmountFormatted: `${(donor.totalAmount / 100).toFixed(2)}€`,
        donationCount: donor.donationCount
      }))
    });
  } catch (error) {
    console.error('Erreur lors de la récupération du leaderboard:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;