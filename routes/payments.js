// routes/payments.js - Gestion des paiements Stripe et PayPal
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { requireAuth, sensitiveRateLimit } = require('../middleware/auth');
const credits = require('../models/credits.repo');
const Joi = require('joi');

const router = express.Router();

// 1) WEBHOOK STRIPE — doit être public + utiliser express.raw()
router.post(
  '/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('❌ Stripe Webhook signature error:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      const userId = parseInt(session.metadata.userId, 10);
      const creditAmount = parseInt(session.metadata.credits, 10);

      try {
        credits.addCredits(
          userId,
          creditAmount,
          'stripe',
          session.id,
          `Achat de ${creditAmount} crédits via Stripe`
        );

        credits.updatePaymentSession(session.id, 'completed');
        console.log(`✅ Paiement Stripe confirmé pour user ${userId}`);
      } catch (err) {
        console.error('Erreur traitement paiement Stripe :', err);
        credits.updatePaymentSession(session.id, 'failed');
      }
    }

    res.json({ received: true });
  }
);

/***************************************
 * 2) AUTH PROTÉGÉ — TOUT LE RESTE
 ***************************************/
router.use(requireAuth);

// Schéma validation création achat crédits
const createPaymentSchema = Joi.object({
  credits: Joi.number().valid(20, 45, 100).required(),
  provider: Joi.string().valid('stripe', 'paypal').required(),
  successUrl: Joi.string().uri().optional(),
  cancelUrl: Joi.string().uri().optional()
});

// GET /packages
router.get('/packages', (req, res) => {
  try {
    const packages = credits.getAvailableCreditPackages();
    res.json({ packages });
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /create
router.post('/create', sensitiveRateLimit, async (req, res) => {
  try {
    const { error } = createPaymentSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { credits: creditAmount, provider, successUrl, cancelUrl } = req.body;
    const userId = req.user.id;
    const price = credits.getCreditPrice(creditAmount);

    if (!price) return res.status(400).json({ error: 'Package de crédits invalide' });

    if (provider === 'stripe') {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'eur',
            product_data: {
              name: `${creditAmount} crédits Ma Spiritualité`,
              description: `Package de ${creditAmount} crédits`
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
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60
      });

      credits.createPaymentSession({
        userId,
        sessionId: session.id,
        provider: 'stripe',
        amount: price,
        credits: creditAmount
      });

      return res.json({
        sessionId: session.id,
        url: session.url,
        provider: 'stripe'
      });
    }

    // PAYPAL
    const sessionId = `paypal_${Date.now()}_${userId}`;
    credits.createPaymentSession({
      userId,
      sessionId,
      provider: 'paypal',
      amount: price,
      credits: creditAmount
    });

    return res.json({
      sessionId,
      amount: price,
      credits: creditAmount,
      provider: 'paypal',
      paypalConfig: {
        clientId: process.env.PAYPAL_CLIENT_ID,
        currency: 'EUR',
        amount: (price / 100).toString()
      }
    });

  } catch (error) {
    console.error('Erreur lors de la création de la session de paiement:', error);
    res.status(500).json({ error: 'Erreur lors de la création du paiement' });
  }
});

/********************************************
 * POST /paypal/confirm — AJOUT PROTECTION
 ********************************************/
router.post('/paypal/confirm', requireAuth, async (req, res) => {
  try {
    const { sessionId, paypalOrderId } = req.body;

    if (!sessionId || !paypalOrderId) {
      return res.status(400).json({ error: 'Session ID et Order ID requis' });
    }

    const session = credits.getPaymentSession(sessionId);
    if (!session || session.userId !== req.user.id) {
      return res.status(404).json({ error: 'Session introuvable' });
    }

    if (session.status !== 'pending') {
      return res.status(400).json({ error: 'Session déjà traitée' });
    }

    credits.addCredits(
      req.user.id,
      session.credits,
      'paypal',
      paypalOrderId,
      `Achat de ${session.credits} crédits via PayPal`
    );

    credits.updatePaymentSession(sessionId, 'completed');

    res.json({
      success: true,
      message: `${session.credits} crédits ajoutés`
    });

  } catch (error) {
    console.error('Erreur confirmation PayPal:', error);
    res.status(500).json({ error: 'Erreur lors de la confirmation' });
  }
});

/**************************************
 * Historique & statut session
 **************************************/
router.get('/history', (req, res) => {
  try {
    const userId = req.user.id;
    res.json({
      transactions: credits.getTransactionsByUser(userId, 20),
      sessions: credits.getPaymentSessionsByUser(userId, 10)
    });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/status/:sessionId', (req, res) => {
  try {
    const session = credits.getPaymentSession(req.params.sessionId);

    if (!session || session.userId !== req.user.id) {
      return res.status(404).json({ error: 'Session non trouvée' });
    }

    res.json(session);

  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
