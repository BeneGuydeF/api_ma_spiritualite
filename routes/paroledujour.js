// routes/paroledujour.js
// -> Renvoie le RÉPONS DU PSAUME uniquement (texte + référence)
//    Params optionnels : ?date=YYYY-MM-DD&zone=France|Canada|... (par défaut: France)
const express = require('express');
const router = express.Router();
const AELFService = require('../services/aelf.service');

function extractRepons(raw) {
  if (!raw) return '';
  // Texte déjà "clean" par le service, on isole la 1ère ligne parlante
  const text = String(raw).replace(/\r\n/g, '\n').trim();
  const firstBlock = text.split(/\n{2,}/)[0]?.trim() || '';
  let firstLine = (firstBlock.split('\n').find(l => l && l.trim().length) || '').trim();

  // Nettoyage des préfixes fréquents : R/, R., tirets
  firstLine = firstLine.replace(/^(R[\/\.\-\–—]\s*)/i, '');

  // Retire guillemets éventuels
  firstLine = firstLine.replace(/^[«"']\s*|\s*[»"']$/g, '');

  return firstLine.trim();
}

router.get('/', async (req, res) => {
  const rawDate = typeof req.query.date === 'string' ? req.query.date.trim() : '';
  const rawZone = typeof req.query.zone === 'string' ? req.query.zone.trim() : '';

  if (rawDate && !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    return res.status(400).json({ error: 'Format de date invalide (YYYY-MM-DD attendu)' });
  }

  const requestedDate = rawDate || null;
  const normalizedZone = rawZone || 'France';
  const isDefaultZone = !rawZone || normalizedZone.toLowerCase() === 'france';
  const effectiveDate = requestedDate || AELFService.getTodayDate();

  const buildResponse = (payload) => {
    const psaume = payload?.psaume || null;

    const reference = psaume?.reference || '';
    const refrain = psaume?.refrain || '';
    const texteComplet = psaume?.texte || '';

    const repons = (refrain && refrain.trim().length)
      ? refrain.trim()
      : extractRepons(texteComplet);

    return {
      texte: repons || '',           // ← UNIQUEMENT le répons
      reference: reference || '',    // ← Référence du psaume
      date: payload?.date || effectiveDate,
      informations: payload?.informations || null,
      source: 'aelf:lectures'
    };
  };

  try {
    const payload = isDefaultZone
      ? await AELFService.getLiturgicalData(requestedDate || undefined)
      : await AELFService.fetchFromAELF(effectiveDate, normalizedZone);

    if (payload?.psaume) {
      return res.json(buildResponse(payload));
    }

    // Fallback : retente France+cache si zone exotique vide
    return res.status(503).json({ error: 'Psaume indisponible (AELF + fallback HTML)' });
  } catch (error) {
    console.error('[/api/paroledujour] error:', error?.message || error);
    try {
      const fallback = await AELFService.getLiturgicalData(requestedDate || undefined);
      if (fallback?.psaume) {
        return res.json(buildResponse(fallback));
      }
    } catch (fallbackErr) {
      console.error('[/api/paroledujour] fallback error:', fallbackErr?.message || fallbackErr);
    }
    return res.status(503).json({ error: 'Service temporairement indisponible' });
  }
});

module.exports = router;
