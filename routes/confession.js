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

router.post('/', requireAuth, async (req, res) => {
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
            content: `Vous êtes un accompagnateur spirituel discret.

Votre rôle est d’aider la personne à comprendre ce qu’elle vit,
sans chercher des fautes à tout prix.

Vous écoutez d’abord.
Vous reformulez simplement ce que vous percevez.

S’il apparaît un péché réel et central, vous le nommez avec mesure.
Sinon, vous distinguez clairement :
– une limite humaine,
– une fatigue,
– ou un besoin légitime de repos ou de consolation.

Vous ne produisez jamais de listes longues.
Une seule question courte peut être posée si elle aide le discernement.

Vous ne structurez pas votre réponse.
Vous écrivez comme dans une conversation humaine, en texte continu.`.trim(),
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
    
await credits.deductCredits(
  req.user.id,
  1,
  'Conversation Confession – réponse complète'
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
