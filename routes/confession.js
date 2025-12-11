console.log("Route /api/confession chargée");

const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const { requireAuth, requireCredits } = require('../middleware/auth');
const credits = require('../models/credits.repo');

// Initialisation OpenAI (timeout global ok)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 10000, // 10 secondes -> optimal pour Confession
});

router.post('/', requireAuth, requireCredits(1), async (req, res) => {
  const { prompt } = req.body;

  // --- HEADERS STREAMING ---
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {

    // --- STREAM OPENAI ---
    const stream = await openai.chat.completions.create(
      {
        model: 'gpt-4.1-mini',
        messages: [
          {
            role: 'system',
            content: `Vous êtes un conseiller spirituel discret, bienveillant et profond. 
Votre mission est d'aider la personne à faire un examen de conscience lucide, 
avec douceur et exigence. Vous définissez ce que sont les péchés, et ciblez ceux que vous reconnaissez ou laissez le choix à l'usager entre deux pour établir votre liste. Vous aidez à reconnaître les péchés d'omission ou de commission, 
les manques d'amour, d'humilité, de vérité. Vous faite une liste des péchés identifiés pour preparer le fidèle à la confession avec un prêtre`.trim(),
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 800,
        temperature: 0.7,
      },
      {
        stream: true, // <<<<<<<<<<<<<<<<<<<<<<<<<<<< MODE STREAMING
        timeout: 10000,
      }
    );

    // --- ÉMISSION PROGRESSIVE DES TOKENS ---
    for await (const chunk of stream) {
      const token = chunk.choices?.[0]?.delta?.content || "";
      res.write(token);   // => Flutter reçoit en direct
    }

    // --- CRÉDITS APRÈS SUCCÈS ---
    credits.deductCredits(
      req.user.id,
      1,
      'Consultation agent IA: Examen de conscience'
    );

    res.end();

  } catch (error) {

    console.error('Erreur IA :', error.response?.data || error.message);

    if (error.message === 'Crédits insuffisants') {
      res.write("ERREUR: Crédits insuffisants.");
      return res.end();
    }

    res.write("ERREUR: Impossible de générer la réponse.");
    res.end();
  }
});

module.exports = router;
