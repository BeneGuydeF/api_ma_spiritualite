// routes/priere.js
console.log("Route /api/priere chargée");

const express = require('express');
const router = express.Router();
const OpenAI = require('openai');

// --- DB facultative (Bible Crampon + Blog) ---------------------------------
let db = null;
try {
  const Database = require('better-sqlite3');
  const dbPath = process.env.SQLITE_PATH || 'data/app.db';
  db = new Database(dbPath, { fileMustExist: false });
} catch (_) {
  // pas de DB => on continue sans contexte local
}

function getBibleCramponSnippets(query, max = 5) {
  if (!db) return [];
  try {
    const stmt = db.prepare(`
      SELECT book, chapter, verse, text
      FROM bible_crampon
      WHERE text LIKE ? OR book LIKE ?
      LIMIT ?
    `);
    const rows = stmt.all(`%${query}%`, `%${query}%`, max);
    return rows.map(r => ({
      ref: `${r.book} ${r.chapter},${r.verse}`,
      text: r.text
    }));
  } catch {
    return [];
  }
}

function getBlogSnippets(query, max = 3) {
  if (!db) return [];
  try {
    const stmt = db.prepare(`
      SELECT title, content, url
      FROM blog_articles
      WHERE content LIKE ? OR title LIKE ?
      ORDER BY rowid DESC
      LIMIT ?
    `);
    const rows = stmt.all(`%${query}%`, `%${query}%`, max);
    return rows.map(r => ({
      title: r.title,
      excerpt: (r.content || '').slice(0, 600),
      url: r.url
    }));
  } catch {
    return [];
  }
}

// --- OpenAI -----------------------------------------------------------------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 15000,
});

// --- Healthcheck -------------------------------------------------------------
router.get('/health', (_req, res) => {
  res.json({ ok: true, route: '/api/priere' });
});

// --- POST /api/priere --------------------------------------------------------
router.post('/', async (req, res) => {
  const { prompt } = req.body || {};

  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt requis' });
  }

  // Contexte local (si DB dispo)
  const crampon = getBibleCramponSnippets(prompt, 6);
  const blog = getBlogSnippets(prompt, 3);

  const cramponBlock = crampon.length
    ? crampon.map(v => `• [CRAMPON ${v.ref}] ${v.text}`).join('\n')
    : 'Aucun extrait local pertinent.';

  const blogBlock = blog.length
    ? blog.map(b => `• [BLOG] ${b.title} — ${b.url}\n${b.excerpt}`).join('\n\n')
    : 'Aucun article local pertinent.';

  // --- HEADERS STREAMING ---
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {

    // --- STREAMING OPENAI ---
    const stream = await openai.chat.completions.create(
      {
        model: 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 900,
        messages: [
          {
            role: 'system',
            content:
`Assistant spirituel discret, savant et rigoureux pour un public cultivé.
Style impératif: sobre, impersonnel, précis, inspirant. Ne jamais s’adresser à la 2e personne, ne pas utiliser « je », « tu » ni points de liste.
Toujours structurer en TROIS PARTIES, sans puces ni numérotation automatique, sous forme de paragraphes continus:

1. Ancrage scripturaire — citer la Bible Crampon (1923) si possible, avec références exactes (Livre, chapitre, verset). Donner un court commentaire spirituel pertinent.
2. Ressource théologique — mentionner un théologien reconnu, une revue ou institution crédible (ex: Bernardins, Communio, etc.). Si un article de blog interne est fourni dans le contexte, le privilégier en donnant le titre et l’URL, avec un résumé exact (et signaler clairement qu’il s’agit d’un billet interne).
3. Réflexion spirituelle — convoquer un ou deux saints / docteurs de l’Église avec courte citation et référence (ouvrage, livre/chapitre si possible), en reliant explicitement au thème de la question.

Contraintes:
- Pas de listes à puces. Pas de numérotation. Pas d’interpellation directe du lecteur.
- Français soutenu, vocabulaire théologique exact, nuances. Longueur raisonnable (400–700 mots).
- Lorsque des extraits « Crampon » figurent dans le CONTEXTE, s’y référer explicitement sous la forme: [CRAMPON Livre chap,verset].
- Pour les billets internes, citer: [BLOG – Titre — URL].
- Si une information est incertaine, rester sobre et le signaler brièvement.
- Pas d’invention de liens. N’indiquer des URLs que si elles sont présentes dans le CONTEXTE fournis.`
          },
          {
            role: 'user',
            content:
`QUESTION UTILISATEUR:
${prompt}

CONTEXTE – BIBLE CRAMPON (si disponible):
${cramponBlock}

CONTEXTE – BLOG INTERNE (si disponible):
${blogBlock}

Consigne: produire une réponse en trois parties, sans listes ni numérotation, en respectant strictement les contraintes de style ci-dessus.`
          }
        ]
      },
      { stream: true, timeout: 15000 }
    );

    // --- ÉMISSION PROGRESSIVE DES TOKENS ---
    for await (const chunk of stream) {
  let token = chunk.choices?.[0]?.delta?.content || "";

  // ⛔ Nettoyage des marqueurs parasites
  token = token
    .replace(/\bRéponse\s*:\s*/gi, '')
    .replace(/\bResponse\s*:\s*/gi, '')
    .replace(/\bS\d+\b\s*[:\-–—]?\s*/g, '')
    .replace(/^\s*[:\-–—]\s*/g, '');

  res.write(token);
}

    res.end();

  } catch (error) {
    console.error('Erreur IA :', error.response?.data || error.message);
    res.write("ERREUR: Impossible de générer la prière.");
    res.end();
  }
});

module.exports = router;
