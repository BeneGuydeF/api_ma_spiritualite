// routes/payments.js - Gestion des paiements Stripe et PayPal
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { requireAuth, sensitiveRateLimit } = require('../middleware/auth');
const credits = require('../models/credits.repo');
const Joi = require('joi');

const router = express.Router();

// Appliquer l'authentification à toutes les routes
router.use(requireAuth);

// Schémas de validation
const createPaymentSchema = Joi.object({
  credits: Joi.number().valid(15, 35, 85).required(),
  provider: Joi.string().valid('stripe', 'paypal').required(),
  successUrl: Joi.string().uri().optional(),
  cancelUrl: Joi.string().uri().optional()
});

// GET /api/payments/packages - Récupérer les packages de crédits disponibles
router.get('/packages', (req, res) => {
  try {
    const packages = credits.getAvailableCreditPackages();
    res.json({ packages });
  } catch (error) {
    console.error('Erreur lors de la récupération des packages:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/payments/create - Créer une session de paiement
router.post('/create', sensitiveRateLimit, async (req, res) => {
  try {
    const { error } = createPaymentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { credits: creditAmount, provider, successUrl, cancelUrl } = req.body;
    const userId = req.user.id;
    const price = credits.getCreditPrice(creditAmount);

    if (!price) {
      return res.status(400).json({ error: 'Package de crédits invalide' });
    }

    if (provider === 'stripe') {
      // Créer une session Stripe Checkout
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'eur',
            product_data: {
              name: `${creditAmount} crédits Ma Spiritualité`,
              description: `Package de ${creditAmount} crédits pour votre carnet spirituel`
            },
            unit_amount: price,
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: successUrl || `${process.env.FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: cancelUrl || `${process.env.FRONTEND_URL}/payment/cancel`,
        metadata: {
          userId: userId.toString(),
          credits: creditAmount.toString(),
          provider: 'stripe'
        },
        expires_at: Math.floor(Date.now() / 1000) + (30 * 60) // 30 minutes
      });

      // Sauvegarder la session de paiement
      credits.createPaymentSession({
        userId,
        sessionId: session.id,
        provider: 'stripe',
        amount: price,
        credits: creditAmount
      });

      res.json({
        sessionId: session.id,
        url: session.url,
        provider: 'stripe'
      });

    } else if (provider === 'paypal') {
      // Pour PayPal, on retournerait ici les informations pour initialiser le SDK côté client
      const sessionId = `paypal_${Date.now()}_${userId}`;
      
      credits.createPaymentSession({
        userId,
        sessionId,
        provider: 'paypal',
        amount: price,
        credits: creditAmount
      });

      res.json({
        sessionId,
        amount: price,
        credits: creditAmount,
        provider: 'paypal',
        // Le frontend utilisera ces infos pour initialiser PayPal SDK
        paypalConfig: {
          clientId: process.env.PAYPAL_CLIENT_ID,
          currency: 'EUR',
          amount: (price / 100).toString()
        }
      });
    }

  } catch (error) {
    console.error('Erreur lors de la création de la session de paiement:', error);
    res.status(500).json({ error: 'Erreur lors de la création du paiement' });
  }
});

// POST /api/payments/stripe/webhook - Webhook Stripe pour confirmer les paiements
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
    const { userId, credits: creditAmount } = session.metadata;

    try {
      // Ajouter les crédits à l'utilisateur
      const newCredits = credits.addCredits(
        parseInt(userId),
        parseInt(creditAmount),
        'stripe',
        session.id,
        `Achat de ${creditAmount} crédits via Stripe`
      );

      // Mettre à jour le statut de la session
      credits.updatePaymentSession(session.id, 'completed');

      console.log(`Paiement confirmé: ${creditAmount} crédits ajoutés à l'utilisateur ${userId}`);
    } catch (error) {
      console.error('Erreur lors du traitement du paiement:', error);
      credits.updatePaymentSession(session.id, 'failed');
    }
  }

  res.json({ received: true });
});

// POST /api/payments/paypal/confirm - Confirmer un paiement PayPal
router.post('/paypal/confirm', async (req, res) => {
  try {
    const { sessionId, paypalOrderId } = req.body;
    
    if (!sessionId || !paypalOrderId) {
      return res.status(400).json({ error: 'Session ID et Order ID PayPal requis' });
    }

    const session = credits.getPaymentSession(sessionId);
    if (!session || session.userId !== req.user.id) {
      return res.status(404).json({ error: 'Session de paiement non trouvée' });
    }

    if (session.status !== 'pending') {
      return res.status(400).json({ error: 'Session de paiement déjà traitée' });
    }

    // Ici, vous devriez vérifier le paiement avec l'API PayPal
    // Pour la démonstration, on considère que le paiement est valide

    // Ajouter les crédits
    const newCredits = credits.addCredits(
      req.user.id,
      session.credits,
      'paypal',
      paypalOrderId,
      `Achat de ${session.credits} crédits via PayPal`
    );

    // Mettre à jour le statut
    credits.updatePaymentSession(sessionId, 'completed');

    res.json({
      success: true,
      newCredits,
      message: `${session.credits} crédits ajoutés à votre compte`
    });

  } catch (error) {
    console.error('Erreur lors de la confirmation PayPal:', error);
    res.status(500).json({ error: 'Erreur lors de la confirmation du paiement' });
  }
});

// GET /api/payments/history - Historique des paiements
router.get('/history', (req, res) => {
  try {
    const userId = req.user.id;
    const transactions = credits.getTransactionsByUser(userId, 20);
    const sessions = credits.getPaymentSessionsByUser(userId, 10);

    res.json({
      transactions,
      sessions
    });
  } catch (error) {
    console.error('Erreur lors de la récupération de l\'historique:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/payments/status/:sessionId - Vérifier le statut d'une session
router.get('/status/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = credits.getPaymentSession(sessionId);

    if (!session || session.userId !== req.user.id) {
      return res.status(404).json({ error: 'Session non trouvée' });
    }

    res.json({
      sessionId: session.sessionId,
      status: session.status,
      provider: session.provider,
      credits: session.credits,
      amount: session.amount,
      createdAt: session.createdAt,
      completedAt: session.completedAt
    });
  } catch (error) {
    console.error('Erreur lors de la vérification du statut:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});


// GET /api/payments/credits/:userId - Consulter les crédits d'un utilisateur
router.get('/credits/:userId', (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);

    if (Number.isNaN(userId)) {
      return res.status(400).json({ error: 'Identifiant utilisateur invalide' });
    }

    const creditInfo = credits.getCreditsByUser(userId);

    if (!creditInfo) {
      return res.json({
        userId,
        creditsTotal: null,
        creditsUsed: null,
        creditsRemaining: null
      });
    }

    res.json({
      userId,
      creditsTotal: creditInfo.total ?? creditInfo.creditsTotal ?? null,
      creditsUsed: creditInfo.used ?? creditInfo.creditsUsed ?? null,
      creditsRemaining: creditInfo.remaining ?? creditInfo.creditsRemaining ?? null
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des crédits:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
module.exports = router;