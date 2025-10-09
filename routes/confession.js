


console.log("Route /api/confession chargée");
const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const { requireAuth, requireCredits } = require('../middleware/auth');
const credits = require('../models/credits.repo');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

router.post('/', requireAuth, requireCredits(1), async (req, res) => {
  const { prompt } = req.body;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
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
    });

    // Déduire 1 crédit après utilisation réussie
    const newCredits = credits.deductCredits(
      req.user.id, 
      1, 
      'Consultation agent IA: Examen de conscience'
    );

    res.json({ 
      response: completion.choices[0].message.content,
      creditsRemaining: newCredits,
      message: 'Consultation examen de conscience - 1 crédit utilisé'
    });
  } catch (error) {
    console.error('Erreur IA :', error.response?.data || error.message);
    
    if (error.message === 'Crédits insuffisants') {
      return res.status(402).json({ 
        error: 'Crédits insuffisants pour utiliser l\'agent IA',
        required: 1,
        available: req.user.credits
      });
    }
    
    res.status(500).json({ error: 'Erreur lors de la communication avec l\'IA' });
  }
});

module.exports = router;
