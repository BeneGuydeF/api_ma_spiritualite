// services/aelf.service.js
// Service AELF : recupere, nettoie et met en cache la messe du jour (evangile + psaume)

const axios = require('axios');
const fs = require('fs');
const path = require('path');

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
   * Zones courantes autorisees : france, canada, suisse, belgique, luxembourg
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
        year: 'numeric', month: '2-digit', day: '2-digit'
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
   * Nom de fichier de cache pour une date + zone
   */
  getCacheFileName(date, country = 'france') {
    const zone = this.normalizeZone(country);
    return path.join(this.cacheDir, `liturgie_${date}_${zone}.json`);
  }

  /**
   * Cache valide (< 24h)
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
   * Nettoyage HTML -> texte
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
   * Recupere la messe du jour depuis AELF
   * (evangile + psaume uniquement dans l'objet retourne)
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
      if (!data || !data.messes || !data.messes[0]) {
        throw new Error('Structure de donnees AELF invalide');
      }

      const messe = data.messes[0];
      const lectures = Array.isArray(messe.lectures) ? messe.lectures : [];

      const evangile = lectures.find(l => l.type === 'evangile');
      const psaume = lectures.find(l => l.type === 'psaume');

      const result = {
        date,
        informations: data.informations,
        evangile: evangile ? {
          titre: evangile.titre || 'Evangile',
          reference: evangile.ref || '',
          intro: evangile.intro_lue || '',
          verset: evangile.verset_evangile ? this.cleanText(evangile.verset_evangile) : '',
          texte: this.cleanText(evangile.contenu),
        } : null,
       psaume: psaume ? {
  reference: psaume.ref || '',
  
  // ⚠️ NOUVEAU : compatibilité totale avec anciens + nouveaux formats AELF
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

      console.log(`[aelf] Donnees recuperees avec succes pour ${date} (${zone})`);
      return result;
    } catch (error) {
      console.error(`[aelf] Erreur AELF ${date} (${country}):`, error.message);
      if (error.response) {
        console.error('Status:', error.response.status);
        console.error('Data:', error.response.data);
      }
      throw error;
    }
  }

  /**
   * Donnees liturgiques avec cache (France par defaut)
   */
  async getLiturgicalData(date = null, country = 'france') {
    const targetDate = date || this.getTodayDate();
    const zone = this.normalizeZone(country);
    const cacheFile = this.getCacheFileName(targetDate, zone);

    try {
      if (this.isCacheValid(cacheFile)) {
        console.log(`[cache] Utilisation du cache pour ${targetDate} (${zone})`);
        const cached = this.readCache(cacheFile);
        if (cached) return cached;
      }

      const fresh = await this.fetchFromAELF(targetDate, zone);
      this.writeCache(cacheFile, fresh);
      return fresh;
    } catch (error) {
      console.error('Erreur lors de la recuperation liturgique:', error);
      if (fs.existsSync(cacheFile)) {
        console.log(`[cache] Utilisation du cache expire pour ${targetDate} (${zone})`);
        const cached = this.readCache(cacheFile);
        if (cached) return cached;
      }
      throw error;
    }
  }

  /**
   * Evangile du jour
   */
  async getTodayGospel() {
    const data = await this.getLiturgicalData();
    if (!data.evangile) throw new Error("Evangile non disponible pour aujourd'hui");
    return {
      titre: data.evangile.titre,
      parole: data.evangile.reference, // compat
      texte: data.evangile.texte,
      reference: data.evangile.reference,
      intro: data.evangile.intro,
      verset: data.evangile.verset,
      date: data.date,
      informations: data.informations
    };
  }

  /**
   * Parole du jour = UNIQUEMENT le repons du psaume (+ reference)
   */
  async getTodayWord() {
    const data = await this.getLiturgicalData(); // France par defaut
    if (!data?.psaume) throw new Error('Psaume non disponible');

    const texte = (data.psaume.refrain || '').trim();
    const reference = data.psaume.reference || '';

    if (!texte) throw new Error('Repons du psaume non disponible');

    return {
      texte,
      reference,
      date: data.date,
      informations: data.informations
    };
  }

  /**
   * Nettoyage du cache (> 7 jours)
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
      if (cleaned > 0) console.log(`[cache] ${cleaned} fichiers de cache expires supprimes`);
    } catch (e) {
      console.error('Erreur lors du nettoyage du cache:', e);
    }
  }
}

module.exports = new AELFService();
