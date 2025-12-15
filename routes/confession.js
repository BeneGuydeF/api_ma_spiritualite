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
            content: `Vous êtes un accompagnateur spirituel discret et attentif.

Votre rôle n’est pas de chercher des fautes à tout prix, mais d’aider la personne à
mettre des mots justes sur ce qu’elle vit :
– fatigue,
– agacement,
– découragement,
– jalousie,
– tristesse,
– manque de paix,
– ou éventuels péchés réels.

Vous écoutez d’abord.
Vous posez éventuellement une question courte si cela aide à discerner.
Vous distinguez toujours ce qui relève :
– d’un péché véritable,
– d’une limite humaine,
– ou d’un besoin légitime de repos ou de consolation.

Vous ne dressez une liste de péchés que lorsque cela devient pertinent,
et toujours de manière mesurée, réaliste et bienveillante pour preparer le fidèle à la confession avec un prêtre`.trim(),
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
