// routes/payments.js — Paiements crédits + dons + webhook Stripe
require('dotenv').config();

const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { requireAuth, sensitiveRateLimit } = require('../middleware/auth');
const credits = require('../models/credits.repo');
const Joi = require('joi');

const router = express.Router();

// ============================================================
// CONSTANTES
// ============================================================
const FRONT = process.env.FRONTEND_URL || "https://maspiritualite.keryxia.fr";

// ============================================================
// VALIDATION
// ============================================================
const createCreditPaymentSchema = Joi.object({
  credits: Joi.number().valid(20, 45, 100).required(),
  provider: Joi.string().valid('stripe', 'paypal').required(),
  successUrl: Joi.string().uri().optional(),
  cancelUrl: Joi.string().uri().optional()
});

const createDonationSchema = Joi.object({
  amount: Joi.number().min(100).required(), // 1€ min
  message: Joi.string().max(500).optional().allow('')
});

// ============================================================
// STRIPE WEBHOOK — SANS AUTH, RAW BODY
// ============================================================
async function stripeWebhookHandler(req, res) {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,              // buffer
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Stripe webhook signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    // ============================================================
    // CASE 1 : DONATION
    // ============================================================
    if (session.metadata?.type === "donation") {
      const amount = session.amount_total;
      const userId = parseInt(session.metadata.userId, 10) || null;

      try {
        credits.updatePaymentSession(session.id, "completed");
        console.log(`🙏 Don confirmé : ${(amount / 100).toFixed(2)}€ — ${session.id}`);

        // 🎁 BONUS pour dons ≥ 40€
        if (userId && amount >= 4000) {
          credits.addCredits(
            userId,
            100,
            "donation_bonus",
            session.id,
            "Bonus 100 crédits (don ≥ 40€)"
          );
          console.log(`🎁 Bonus appliqué : +100 crédits pour user ${userId}`);
        }

        return res.json({ received: true });

      } catch (err) {
        console.error("Erreur traitement don :", err);
        credits.updatePaymentSession(session.id, "failed");
        return res.json({ received: true, error: true });
      }
    }

    // ============================================================
    // CASE 2 : ACHAT DE CRÉDITS
    // ============================================================
    const userId = parseInt(session.metadata?.userId, 10);
    const creditAmount = parseInt(session.metadata?.credits, 10);

    if (Number.isFinite(userId) && Number.isFinite(creditAmount)) {
      try {
        credits.addCredits(
          userId,
          creditAmount,
          "stripe",
          session.id,
          `Achat de ${creditAmount} crédits`
        );

        credits.updatePaymentSession(session.id, "completed");

        console.log(`💳 Crédit ajouté : +${creditAmount} pour user ${userId}`);

      } catch (err) {
        console.error("Erreur paiement crédits :", err);
        credits.updatePaymentSession(session.id, "failed");
      }

      return res.json({ received: true });
    }
  }

  return res.json({ received: true });
}

// ============================================================
// ROUTES PROTÉGÉES (AUTH OBLIGATOIRE)
// ============================================================
router.use(requireAuth);

// ============================================================
// PACKAGES CRÉDITS
// ============================================================
router.get('/packages', (req, res) => {
  res.json({ packages: credits.getAvailableCreditPackages() });
});

// ============================================================
// CRÉATION SESSION — ACHAT CRÉDITS
// ============================================================
router.post('/create', sensitiveRateLimit, async (req, res) => {
  try {
    const { error } = createCreditPaymentSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { credits: creditAmount, provider, successUrl, cancelUrl } = req.body;
    const userId = req.user.id;

    const price = credits.getCreditPrice(creditAmount);
    if (!price) return res.status(400).json({ error: "Package de crédits invalide" });

    if (provider === "stripe") {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [{
          price_data: {
            currency: "eur",
            product_data: {
              name: `${creditAmount} crédits Ma Spiritualité`,
              description: `Package de ${creditAmount} crédits`
            },
            unit_amount: price
          },
          quantity: 1
        }],
        mode: "payment",
        success_url: successUrl || `${FRONT}/payment/success`,
        cancel_url: cancelUrl || `${FRONT}/payment/cancel`,
        metadata: {
          type: "credits",
          userId: userId.toString(),
          credits: creditAmount.toString()
        }
      });

      credits.createPaymentSession({
        userId,
        sessionId: session.id,
        provider: "stripe",
        amount: price,
        credits: creditAmount
      });

      return res.json({ sessionId: session.id, url: session.url });
    }

    return res.status(400).json({ error: "Fournisseur de paiement invalide" });

  } catch (err) {
    console.error("Erreur create payment :", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ============================================================
// CRÉATION SESSION — DON
// ============================================================
router.post('/donation', sensitiveRateLimit, async (req, res) => {
  try {
    const { error } = createDonationSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { amount, message } = req.body;
    const userId = req.user.id;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "eur",
          product_data: {
            name: "Don - Ma Spiritualité",
            description: message || "Merci pour votre générosité."
          },
          unit_amount: amount
        },
        quantity: 1
      }],
      mode: "payment",
      success_url: `${FRONT}/donation/success`,
      cancel_url: `${FRONT}/donation/cancel`,
      metadata: {
        type: "donation",
        userId: userId.toString(),
        message: message || ""
      }
    });

    credits.createPaymentSession({
      userId,
      sessionId: session.id,
      provider: "stripe",
      amount,
      credits: 0          // ✔ IMPOSSIBLE de mettre null → SQLite NOT NULL
    });

    return res.json({ sessionId: session.id, url: session.url });

  } catch (err) {
    console.error("Erreur donation :", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ============================================================
// EXPORT
// ============================================================
module.exports = {
  router,
  stripeWebhookHandler
};
