console.log("Route /api/confession chargée");

const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const { requireAuth } = require('../middleware/auth');
const credits = require('../models/credits.repo');
const db = require('../db/sqlite');
const { generateHash } = require('../utils/crypto');

// Initialisation OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 10000, // 10 secondes -> optimal pour Confession
});

router.post('/', requireAuth, async (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt || !String(prompt).trim()) {
    return res.status(400).json({ error: "prompt manquant" });
  }

  // ✅ Cache key stable
  const systemPrompt = `Vous êtes un conseiller spirituel discret, bienveillant et profond. vous vouvoyez votre interlocuteur mais utilisez au maximum les tournures de phrases indirectes.
Votre mission est d'aider la personne à faire un examen de conscience lucide, 
avec douceur et exigence. Vous définissez ce que sont les péchés, donnez une liste des péchés possibles et ciblez ceux que vous reconnaissez. Vous aidez à reconnaître les péchés d'omission ou de commission, 
les manques d'amour, d'humilité, de vérité. Vous faite une liste des péchés identifiés pour preparer le fidèle à la confession avec un prêtre`.trim();

  const userPrompt = String(prompt).trim();

  const cacheKey = `ia|confession|${generateHash(JSON.stringify({
    system: systemPrompt,
    prompt: userPrompt,
    model: 'gpt-4o-mini'
  }))}`;

  // ✅ 1) Cache lookup (pas de crédits si cache)
  try {
    const row = db
      .prepare('SELECT response FROM ia_cache WHERE cache_key = ?')
      .get(cacheKey);

    if (row && row.response) {
      return res.json({ response: row.response, from: 'cache' });
    }
  } catch (e) {
    // Si table pas prête (dev), on continue sans bloquer
    console.warn('[confession] cache lookup failed:', e?.message || e);
  }

  // ✅ 2) IA call
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 800,
      temperature: 0.7,
    });

    const answer = completion?.choices?.[0]?.message?.content || '';

    // ✅ 3) Cache write (best-effort)
    try {
      db.prepare(`
        INSERT OR REPLACE INTO ia_cache (cache_key, response)
        VALUES (?, ?)
      `).run(cacheKey, answer);
    } catch (e) {
      console.warn('[confession] cache write failed:', e?.message || e);
    }

    // ✅ 4) Déduction du crédit APRÈS succès (uniquement si IA)
    await credits.deductCredits(
      req.user.id,
      1,
      'Conversation Confession – réponse complète'
    );

    return res.json({ response: answer, from: 'ai' });

  } catch (error) {
    console.error('Erreur IA :', error.response?.data || error.message);

    if (error.message === 'Crédits insuffisants') {
      return res.status(402).json({ error: 'Crédits insuffisants' });
    }

    return res.status(500).json({ error: 'Impossible de générer la réponse.' });
  }
});


module.exports = router;
