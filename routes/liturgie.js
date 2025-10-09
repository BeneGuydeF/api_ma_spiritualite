// routes/liturgie.js (ESM)
// routes/liturgie.js
const express = require('express');
const router = express.Router();
const AELFService = require('../services/aelf.service');

router.get('/', async (req, res) => {
  try {
    const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date : undefined;
    const data = await AELFService.getLiturgicalData(date);
    res.json(data);
  } catch (e) {
    res.status(503).json({ error: 'Service temporairement indisponible' });
  }
});
module.exports = router;

// -------- utils --------
const nbps   = (s = "") => s.replace(/\u00A0/g, " ");
const clean  = (s = "") => nbps(s).replace(/\r\n/g, "\n").trim();
const inline = (s = "") => clean(s).replace(/\s+/g, " ").trim();
const firstPara = (s = "") => {
  const t = clean(s);
  if (!t) return "";
  const parts = t.split(/\n{2,}|\n/).map(inline).filter(Boolean);
  return parts[0] || t;
};

// yyyy-mm-dd en Europe/Paris (sans dépendance externe)
function todayParisYMD() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find(p => p.type === "year")?.value;
  const m = parts.find(p => p.type === "month")?.value;
  const d = parts.find(p => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

function readJsonSafe(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isUpToDate(payload, ymd) {
  if (!payload || payload.date !== ymd) return false;
  const okEv = payload.evangile && typeof payload.evangile.texte === "string";
  const okPs = payload.psaume && (typeof payload.psaume.refrain === "string" || typeof payload.psaume.texte === "string");
  return okEv && okPs;
}

async function fetchAelfMesses(date, zone = "france") {
  const url = `https://api.aelf.org/v1/messes/${date}/France`;
  const r = await axios.get(url, { headers: { Accept: "application/json" }, timeout: 10000 });
  const messes = Array.isArray(r.data?.messes) ? r.data.messes : [];

  let ev = null, ps = null;
  for (const m of messes) {
    const L = Array.isArray(m?.lectures) ? m.lectures : [];
    ev = ev || L.find(x => (x?.type || "").toLowerCase() === "evangile");
    ps = ps || L.find(x => (x?.type || "").toLowerCase() === "psaume");
    if (ev && ps) break;
  }

  const evangile = ev ? {
    titre:     inline(ev.titre || ""),
    reference: inline(ev.reference || ""),
    texte:     clean(ev.texte || "")
  } : { titre: "", reference: "", texte: "" };

  const psaume = ps ? {
    refrain:   inline(ps.refrain || ""),
    reference: inline(ps.reference || ""),
    texte:     clean(ps.texte || "")
  } : { refrain: "", reference: "", texte: "" };

  const paroleTexte = psaume.refrain
    ? psaume.refrain
    : (evangile.texte ? `Parole d’Évangile : ${firstPara(evangile.texte)}` : "");
  const paroleRef = psaume.refrain
    ? psaume.reference
    : [evangile.titre, evangile.reference && `(${evangile.reference})`].filter(Boolean).join(" ");

  return {
    date,
    source: "aelf:messes",
    evangile,
    psaume,
    // rétro-compat front actuel :
    parole: [paroleTexte, paroleRef && ` ${paroleRef}`].filter(Boolean).join("")
  };
}

// -------- route --------
// GET /api/liturgie?date=YYYY-MM-DD&zone=france
// -> lit data/liturgie.json ; si absent/pas du jour (Paris), rafraîchit depuis AELF, écrit, renvoie.
router.get("/", async (req, res) => {
  const ymd  = inline(req.query.date || todayParisYMD());
  const zone = inline(req.query.zone || "France");

  try {
    let payload = readJsonSafe(dataFile);

    if (!isUpToDate(payload, ymd)) {
      const fresh = await fetchAelfMesses(ymd, zone);
      // si AELF ne renvoie rien d'exploitable, on garde l'ancien fichier s'il existe
      if (fresh && (fresh.evangile?.texte || fresh.psaume?.refrain || fresh.psaume?.texte)) {
        fs.mkdirSync(path.dirname(dataFile), { recursive: true });
        fs.writeFileSync(dataFile, JSON.stringify(fresh, null, 2), "utf8");
        payload = fresh;
      } else if (!payload) {
        // rien à servir
        return res.status(502).json({ ok: false, error: "aelf_empty" });
      }
    }

    return res.json({ ok: true, data: payload });
  } catch (e) {
    console.error("[/api/liturgie] error:", e?.message || e);
    // en cas d'erreur AELF, tenter de servir le cache si présent
    const cached = readJsonSafe(dataFile);
    if (cached) return res.json({ ok: true, data: cached, stale: true });
    return res.status(500).json({ ok: false, error: "liturgie_failed" });
  }
});

module.exports = router;
