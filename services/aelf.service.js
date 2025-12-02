// services/aelf.service.js
// Service AELF : recupere, nettoie et met en cache la messe du jour (evangile + psaume)

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
class AELFService {
  constructor() {
    this.baseURL = 'https://api.aelf.org/v1';
    this.cacheDir = path.join(__dirname, '..', 'data', 'cache');
    this.ensureCacheDirectory();
  }

  ensureCacheDirectory() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Normalise une zone pour l'API AELF (slug attendu)
   */
  normalizeZone(country) {
    const s = String(country || 'france').trim().toLowerCase();
    const map = {
      fr: 'france', fr_fr: 'france', france: 'france',
      ca: 'canada', canada: 'canada',
      ch: 'suisse', suisse: 'suisse', switzerland: 'suisse',
      be: 'belgique', belgique: 'belgique', belgium: 'belgique',
      lu: 'luxembourg', luxembourg: 'luxembourg'
    };
    return map[s] || s;
  }

  /**
   * Date du jour au format YYYY-MM-DD (Europe/Paris)
   */
  getTodayDate() {
    try {
      const now = new Date();
      const fmt = new Intl.DateTimeFormat('fr-FR', {
        timeZone: 'Europe/Paris',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const parts = fmt.formatToParts(now).reduce((acc, p) => {
        acc[p.type] = p.value;
        return acc;
      }, {});
      return `${parts.year}-${parts.month}-${parts.day}`;
    } catch {
      return new Date().toISOString().split('T')[0];
    }
  }

  /**
   * Nom de fichier cache
   */
  getCacheFileName(date, country = 'france') {
    const zone = this.normalizeZone(country);
    return path.join(this.cacheDir, `liturgie_${date}_${zone}.json`);
  }

  /**
   * Cache valide ?
   */
  isCacheValid(cacheFile) {
    try {
      if (!fs.existsSync(cacheFile)) return false;
      const stats = fs.statSync(cacheFile);
      const now = new Date();
      const hoursDiff = (now - stats.mtime) / (1000 * 60 * 60);
      return hoursDiff < 24;
    } catch {
      return false;
    }
  }

  readCache(cacheFile) {
    try {
      return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    } catch {
      return null;
    }
  }

  writeCache(cacheFile, data) {
    try {
      fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Nettoyage HTML → texte
   */
  cleanText(html) {
    if (!html) return '';
    return String(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\u00A0/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\n\s+\n/g, '\n\n')
      .trim();
  }

  /**
   * Récupération AELF (messe)
   */
  async fetchFromAELF(date, country = 'france') {
    const zone = this.normalizeZone(country);
    try {
      console.log(`[aelf] Recuperation des donnees pour ${date} (${zone})...`);
      const url = `${this.baseURL}/messes/${date}/${zone}`;
      const response = await axios.get(url, {
        timeout: 10000,
        headers: { 'User-Agent': 'Ma-Spiritualite-App/1.0' }
      });

      const data = response.data;

      // ⚠ Protection : si HTML → fallback
      if (typeof data !== 'object' || !data.messes) {
        console.error('[AELF] Réponse HTML détectée → fallback nécessaire');
        throw new Error('AELF_HTML');
      }

      if (!data.messes || !data.messes[0]) {
        throw new Error('Structure de donnees AELF invalide');
      }

      const messe = data.messes[0];
      const lectures = Array.isArray(messe.lectures) ? messe.lectures : [];

      const evangile = lectures.find(l => l.type === 'evangile');

      const psaume = lectures.find(l => {
        const t = (l.type || '').toLowerCase();
        return t.includes('psaume') || t.includes('psalm');
      });

      return {
        date,
        informations: data.informations,
        evangile: evangile ? {
          titre: evangile.titre || 'Evangile',
          reference: evangile.ref || '',
          intro: evangile.intro_lue || '',
          verset: evangile.verset_evangile ? this.cleanText(evangile.verset_evangile) : '',
          texte: this.cleanText(evangile.contenu)
        } : null,

        psaume: psaume ? {
          reference: psaume.ref || '',
          refrain: psaume.refrain
            ? this.cleanText(psaume.refrain)
            : (psaume.refrain_psalmique
              ? this.cleanText(psaume.refrain_psalmique)
              : ''),
          texte: this.cleanText(psaume.contenu || '')
        } : null,

        zone,
        cachedAt: new Date().toISOString()
      };

    } catch (error) {
      console.error(`[aelf] Erreur AELF ${date} (${country}):`, error.message);
      throw error;
    }
  }

  /**
   * Fallback messe→ psaume
   */
  async fetchPsalmFallbackLaudes(date, country = 'france') {
    const zone = this.normalizeZone(country);
    try {
      const url = `${this.baseURL}/messe/${date}/${zone}`;
      const response = await axios.get(url, { timeout: 8000 });
      const data = response.data;
      if (!data) return null;

      const psInvit = data?.invitatoire?.psaume;
      const psLaudes = data?.psaume;
      const raw = psInvit || psLaudes;
      if (!raw) return null;

      return {
        reference: raw.ref || raw.reference || '',
        refrain: raw.refrain ? this.cleanText(raw.refrain) : '',
        texte: this.cleanText(raw.contenu || raw.texte || '')
      };

    } catch (err) {
      console.error('[AELF Laudes] Fallback impossible:', err.message);
      return null;
    }
  }
  /**
   * Scraper HTML AELF → extraction du répons du psaume
   */
  async fetchPsalmFromHTML(date, country = 'france') {
    const zone = this.normalizeZone(country);
    const url = `https://aelf.org/${date}/messe`;

    try {
      console.log(`[AELF HTML] Scraping du psaume pour ${date} (${zone})`);

      const response = await axios.get(url, { timeout: 8000 });
      const html = response.data;

      if (typeof html !== 'string') return null;

      const $ = cheerio.load(html);

      const psHeader = $('h3').filter((i, el) =>
        $(el).text().toLowerCase().includes('psaume')
      ).first();

      if (!psHeader || psHeader.length === 0) return null;

      const container = psHeader.nextUntil('h3');

      let reference = '';
      let refrain = '';
      let contenu = '';

      container.each((i, el) => {
        const text = $(el).text().trim();
        if (!text) return;

        if (text.match(/^Psaume/i) || text.match(/^Ps /i)) {
          reference = text;
        }

        if (text.startsWith('R/')) {
          refrain = text.replace(/^R\/\s*/, '').trim();
        }

        contenu += text + '\n';
      });

      if (!refrain) return null;

      return {
        reference,
        refrain,
        texte: contenu.trim()
      };

    } catch (err) {
      console.error('[AELF HTML] Erreur de scraping:', err.message);
      return null;
    }
  }

  /**
   * Données liturgiques
   */
  async getLiturgicalData(date = null, country = 'france') {
    const targetDate = date || this.getTodayDate();
    const zone = this.normalizeZone(country);
    const cacheFile = this.getCacheFileName(targetDate, zone);

    // 1 — Cache valide
    if (this.isCacheValid(cacheFile)) {
      console.log(`[cache] Utilisation du cache pour ${targetDate} (${zone})`);
      const cached = this.readCache(cacheFile);
      if (cached) return cached;
    }

    // 2 — API JSON
    let fresh = null;
    try {
      fresh = await this.fetchFromAELF(targetDate, zone);

    } catch (error) {
      console.error('[AELF] Erreur JSON → fallback Laudes');

      const fallbackPsalm = await this.fetchPsalmFallbackLaudes(targetDate, zone);
      if (fallbackPsalm) {
        fresh = {
          date: targetDate,
          informations: null,
          evangile: null,
          psaume: fallbackPsalm,
          zone,
          cachedAt: new Date().toISOString()
        };
        this.writeCache(cacheFile, fresh);
        return fresh;
      }

      if (fs.existsSync(cacheFile)) {
        const cached = this.readCache(cacheFile);
        if (cached) return cached;
      }

      throw error;
    }

  // 3️⃣ Si API JSON fonctionne mais psaume absent : fallback Laudes
  if (!fresh.psaume) {
    const fallbackPsalm = await this.fetchPsalmFallbackLaudes(targetDate, zone);
    if (fallbackPsalm) {
      fresh.psaume = fallbackPsalm;
      console.log('[AELF] Psaume ajouté via fallback Laudes');
    }
  }
 // 3️⃣ bis – Si toujours pas de psaume → fallback HTML
  if (!fresh.psaume) {
    const htmlPsalm = await this.fetchPsalmFromHTML(targetDate, zone);
    if (htmlPsalm) {
      fresh.psaume = htmlPsalm;
      console.log('[AELF] Psaume récupéré via HTML scraping');
    }
  }

    // 4 — cache + retour
    this.writeCache(cacheFile, fresh);
    return fresh;
  }

  /**
   * Evangile du jour
   */
  async getTodayGospel() {
    const data = await this.getLiturgicalData();
    if (!data.evangile)
      throw new Error("Evangile non disponible pour aujourd'hui");

    return {
      titre: data.evangile.titre,
      parole: data.evangile.reference,
      texte: data.evangile.texte,
      reference: data.evangile.reference,
      intro: data.evangile.intro,
      verset: data.evangile.verset,
      date: data.date,
      informations: data.informations
    };
  }
  

  /**
   * Parole du jour = répons du psaume
   */
  async getTodayWord() {
    const data = await this.getLiturgicalData();
    if (!data?.psaume) throw new Error('Psaume non disponible');

    const texte = (data.psaume.refrain || '').trim();
    if (!texte) throw new Error('Repons du psaume non disponible');

    return {
      texte,
      reference: data.psaume.reference || '',
      date: data.date,
      informations: data.informations
    };
  }

  /**
   * Nettoyage du cache
   */
  cleanOldCache() {
    try {
      const files = fs.readdirSync(this.cacheDir);
      const now = new Date();
      let cleaned = 0;

      for (const file of files) {
        if (!file.startsWith('liturgie_') || !file.endsWith('.json')) continue;

        const fp = path.join(this.cacheDir, file);
        const stats = fs.statSync(fp);
        const daysDiff = (now - stats.mtime) / (1000 * 60 * 60 * 24);

        if (daysDiff > 7) {
          fs.unlinkSync(fp);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        console.log(`[cache] ${cleaned} fichiers nettoyés`);
      }

    } catch (e) {
      console.error('Erreur nettoyage cache:', e);
    }
  }
}

module.exports = new AELFService();
