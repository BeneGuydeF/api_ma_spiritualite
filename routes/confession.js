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
          content:  `Vous êtes un conseiller spirituel discret, bienveillant et profond. vous vouvoyez votre interlocuteur mais utilisez au maximum les tournures de phrases indirectes.
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
