console.log("Route /api/confession chargée");

const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const { requireAuth } = require('../middleware/auth');
const credits = require('../models/credits.repo');

// Initialisation OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 10000, // 10 secondes -> optimal pour Confession
});

router.post('/', requireAuth, async (req, res) => {
  const { prompt } = req.body;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
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
    });

    const answer = completion.choices[0].message.content;

    // Déduction du crédit APRÈS succès
    await credits.deductCredits(
      req.user.id,
      1,
      'Conversation Confession – réponse complète'
    );

    return res.json({
      response: answer,
    });

  } catch (error) {
    console.error('Erreur IA :', error.response?.data || error.message);

    if (error.message === 'Crédits insuffisants') {
      return res.status(402).json({
        error: 'Crédits insuffisants',
      });
    }

    return res.status(500).json({
      error: 'Impossible de générer la réponse.',
    });
  }
}); 

module.exports = router;
