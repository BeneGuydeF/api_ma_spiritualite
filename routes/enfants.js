const express = require('express');
const OpenAI = require('openai');
const router = express.Router();
const { generateHash } = require('../utils/crypto');
console.log('✅ routes/enfants.js (IA + prompt original) chargé');

// --- INIT OpenAI ---
let _openai = null;
function getOpenAI() {
  if (_openai) return _openai;
  const key = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || '';
  if (!key) return null;
  _openai = new OpenAI({ apiKey: key });
  return _openai;
}



// --- Routes simples ---
router.get('/', (_req, res) => res.json({ ok: true, route: '/api/enfants' }));
router.get('/health', (_req, res) => res.json({ ok: true, route: '/api/enfants/health' }));


router.post('/', async (req, res) => {
  const { prompt, ageRange, reference, theme } = req.body || {};

  if (!ageRange || !reference) {
    return res.status(400).json({ error: 'ageRange ou reference manquant' });
  }

   // 🔑 HEADERS STREAMING — ICI ET NULLE PART AILLEURS
 



  const rage = (ageRange || '').toLowerCase();
  let age = '7-9';
  if (/^4/.test(rage)) age = '4-6';
  else if (/10/.test(rage)) age = '10-12';
  else if (/13|14|15/.test(rage)) age = '13-15';

  const parts = [];
  parts.push(`Tranche d'âge: ${age}.`);
  if (reference) parts.push(`Référence biblique: ${reference}.`);
  if (theme) parts.push(`Thème: ${theme}.`);
  const userPrompt = [parts.join(' '), prompt].filter(Boolean).join('\n\n');

  const cacheKey = `ia|enfants|${generateHash(JSON.stringify({
  reference,
  ageRange: age,
  theme,
  prompt: userPrompt
}))}`;

const client = getOpenAI();
if (!client) {
  return res.status(503).json({ error: 'OpenAI non configuré' });
}
const row = db
  .prepare('SELECT response FROM ia_cache WHERE cache_key = ?')
  .get(cacheKey);

if (row) {
  return res.json({
    response: row.response,
    from: 'cache'
  });
}

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
             "Vous expliquez l'Évangile du jour aux enfants avec exactitude et délicatesse." +
          "Vous vous adressez à des enfants de CSP+, avec une culture religieuse en cours d'acquisition." +
          "Adaptez le vocabulaire à la tranche d'âge sans infantiliser."+
          "Toujours respecter le texte et éviter les interprétations hasardeuses."+
          "Structure: 1) Résumé 3–5 phrases; 2) Idée clé; 3) Deux questions; 4) Petite prière." +
          "Expliquez comment lire les versets et se repérer dans la Bible." +
          "Langue: français ; style simple, digne et clair; vouvoyez l'usager."
        },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 750,
      temperature: 0.5,
    });

  
    const content = completion?.choices?.[0]?.message?.content || '';
    db.prepare(`
  INSERT OR REPLACE INTO ia_cache (cache_key, response)
  VALUES (?, ?)
`).run(cacheKey, content);

return res.json({
  response: content,
  from: 'ai'
});

 } catch (err) {
  console.error('Erreur IA enfants:', err?.response?.data || err?.message || err);
  return res.status(500).json({
    error: 'Erreur lors de la génération IA'
  });
}
});


// --- POST /evaluer (diagnostic local sans IA) ---
router.post('/evaluer', (req, res) => {
  const { age, theme, texte } = req.body || {};
  res.json({
    ok: true,
    route: '/api/enfants/evaluer',
    received: { age, theme, texte },
    from: 'backend',
  });
});

module.exports = router;
