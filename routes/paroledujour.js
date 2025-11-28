// routes/paroledujour.js
// -> Renvoie le RÉPONS DU PSAUME uniquement (texte + référence)

const express = require('express');
const router = express.Router();
const AELFService = require('../services/aelf.service');

/* -------------------------------------------------------
 * Nettoyage d’un répons du psaume
 * -----------------------------------------------------*/
function extractRepons(raw) {
  if (!raw) return '';

  const text = String(raw).replace(/\r\n/g, '\n').trim();
  const firstBlock = text.split(/\n{2,}/)[0]?.trim() || '';
  let firstLine = (firstBlock.split('\n').find(l => l && l.trim().length) || '').trim();

  // Préfixes R/ etc.
  firstLine = firstLine.replace(/^(R[\/\.\-\–—]\s*)/i, '');
  // Guillemets
  firstLine = firstLine.replace(/^[«"']\s*|\s*[»"']$/g, '');

  return firstLine.trim();
}

/* -------------------------------------------------------
 * Route principale
 * -----------------------------------------------------*/
router.get('/', async (req, res) => {
  const rawDate = typeof req.query.date === 'string' ? req.query.date.trim() : '';
  const rawZone = typeof req.query.zone === 'string' ? req.query.zone.trim() : '';

  if (rawDate && !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    return res.status(400).json({ error: 'Format de date invalide (YYYY-MM-DD attendu)' });
  }

  const requestedDate = rawDate || null;
  const normalizedZone = rawZone || 'France';
  const effectiveDate = requestedDate || AELFService.getTodayDate();

  try {
    const lit = await AELFService.getLiturgie(effectiveDate, normalizedZone);

    if (!lit || !lit.psaume) {
      return res.status(404).json({ error: 'Psaume indisponible.' });
    }

    const psaume = lit.psaume;
    const reference = psaume.reference || '';
    const refrain = psaume.refrain || '';
    const texteComplet = psaume.texte || '';

    const repons = refrain.trim().length
      ? refrain.trim()
      : extractRepons(texteComplet);

    if (!repons) {
      return res.status(404).json({ error: 'Répons introuvable.' });
    }

    return res.json({
      repons: {
        texte: repons,
        reference: reference,
        date: effectiveDate,
      }
    });

  } catch (e) {
    console.error('[paroledujour] Error:', e);
    return res.status(500).json({ error: 'paroledujour_failed' });
  }
});

module.exports = router;
