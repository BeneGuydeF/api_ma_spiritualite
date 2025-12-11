// routes/evangile.js
const express = require('express');
const router = express.Router();
const AELFService = require('../services/aelf.service');
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 8000,
});

// ─────────────────────────────────────────────
// Génère 2 idées principales à partir du texte
// ─────────────────────────────────────────────
async function generateIdeas(text) {
  try {
    const prompt = `
Voici un évangile :

${text}

Donne EXACTEMENT 2 idées principales, simples et spirituelles.
Format obligatoire :
- Idée 1
- Idée 2
    `.trim();

    const rep = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: "Tu es un théologien catholique, concis et fidèle." },
        { role: "user", content: prompt }
      ],
      max_tokens: 200,
      temperature: 0.4,
    });

    const raw = rep.choices[0].message.content || "";

    const lines = raw
      .split("\n")
      .map(l => l.replace(/^-?\s*•?\s*/, "").trim())
      .filter(l => l.length > 0)
      .slice(0, 2);

    return lines.length === 2 ? lines : [];
  } catch (err) {
    console.error("Erreur synthèse évangile:", err);
    return [];
  }
}

// ─────────────────────────────────────────────
// Route : GET /api/evangile
// ─────────────────────────────────────────────
router.get('/', async (req, res) => {
  const rawDate = typeof req.query.date === 'string' ? req.query.date.trim() : '';
  const rawZone = typeof req.query.zone === 'string' ? req.query.zone.trim() : '';

  const requestedDate = rawDate || null;
  const requestedZone = rawZone || null;

  if (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    return res.status(400).json({ error: 'Format de date invalide (YYYY-MM-DD attendu)' });
  }

  try {
    // Évangile complet
    const gospel = await AELFService.getTodayGospel();

    if (gospel) {
      // Texte complet pour l’IA
      const textForIA = [
        gospel.titre,
        gospel.intro,
        gospel.reference,
        gospel.verset,
        gospel.texte
      ].filter(Boolean).join("\n\n");

      // Idées principales
      const idees = await generateIdeas(textForIA);

      res.set('X-MSP-Route', 'routes/evangile.js:getTodayGospel');
      return res.json({
        evangile: gospel,
        idees
      });
    }

    throw new Error('Evangile indisponible');
  } catch (error) {
    console.error('[/api/evangile] error:', error?.message || error);

    return res.status(503).json({
      error: 'Impossible de récupérer les textes liturgiques du jour.'
    });
  }
});

module.exports = router;
