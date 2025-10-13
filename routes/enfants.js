const express = require('express');
const OpenAI = require('openai');
const router = express.Router();

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

// --- Génération SVG (illustration simple selon thème) ---
function buildMonochromeSvg({ theme, reference, ageRange }) {
  const t = (theme || '').toLowerCase();
  let inner = '';

  if (t.includes('brebis') || t.includes('mouton') || t.includes('perdue')) {
    inner = `<circle cx="64" cy="56" r="28" stroke="#000" stroke-width="4" fill="none"/>
             <circle cx="52" cy="52" r="6" fill="#000"/>`;
  } else if (t.includes('colombe') || t.includes('esprit')) {
    inner = `<path d="M20 70 Q50 30 100 60" stroke="#000" stroke-width="4" fill="none"/>
             <circle cx="22" cy="68" r="3" fill="#000"/>`;
  } else if (t.includes('lumi') || t.includes('cierge') || t.includes('bougie')) {
    inner = `<rect x="54" y="48" width="20" height="40" stroke="#000" stroke-width="4" fill="none"/>
             <path d="M64 44 C60 40, 62 34, 64 32 C66 34, 68 40, 64 44" fill="#000"/>`;
  } else if (t.includes('sem') || t.includes('grain') || t.includes('graines')) {
    inner = `<circle cx="36" cy="64" r="12" stroke="#000" stroke-width="4" fill="none"/>
             <circle cx="88" cy="82" r="2" fill="#000"/>`;
  } else {
    inner = `<rect x="24" y="40" width="80" height="40" stroke="#000" stroke-width="4" fill="none"/>`;
  }

  const subtitle = [reference, ageRange].filter(Boolean).join(' • ');
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <rect width="128" height="128" fill="#fff"/>
    ${inner}
    ${subtitle ? `<text x="64" y="116" font-size="10" text-anchor="middle" fill="#000">${subtitle}</text>` : ''}
  </svg>`;
}

// --- Routes simples ---
router.get('/', (_req, res) => res.json({ ok: true, route: '/api/enfants' }));
router.get('/health', (_req, res) => res.json({ ok: true, route: '/api/enfants/health' }));

// --- IA principale ---
router.post('/', async (req, res) => {
  const { prompt, ageRange, reference, theme } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt manquant' });
  }

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

  const client = getOpenAI();
  if (!client) return res.status(503).json({ error: 'OpenAI non configuré' });

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
    const svg = buildMonochromeSvg({ theme, reference, ageRange: age });
    const illustration = {
      type: 'svg',
      data: Buffer.from(svg, 'utf8').toString('base64'),
    };

    res.json({
      response: content,
      illustration,
      ageRange: age,
      reference,
      theme,
    });
  } catch (err) {
    console.error('Erreur IA enfants:', err?.response?.data || err.message);
    res.status(500).json({ error: 'Erreur lors de la communication avec l’IA' });
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
