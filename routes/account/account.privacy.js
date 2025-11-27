const express = require('express');
const router = express.Router();

// chemins corrects depuis routes/account/
const db = require('../../db/sqlite');
const { requireAuth } = require('../../middleware/auth');

// Vérifie si une table existe
const exists = (t) =>
  !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);

// ======================
// Sélecteurs
// ======================
const selUser = db.prepare(`
  SELECT id,
         email,
         name,
         age_bucket AS ageBucket,
         theme,
         analytics,
         credits,
         createdAt
  FROM users
  WHERE id = ?
`);

const selJournal = exists('journal_entries')
  ? db.prepare(`
      SELECT
        id,
        title,
        encryptedContent,
        encryptedTags,
        createdAt
      FROM journal_entries
      WHERE userId = ?
      ORDER BY createdAt ASC
    `)
  : null;


// ==============================
// POST /api/account/export
// ==============================
router.post('/export', requireAuth, (req, res) => {
  const uid = Number(req.user?.id);
  if (!Number.isFinite(uid)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const user = selUser.get(uid);
  if (!user) {
    return res.status(404).json({ error: 'introuvable' });
  }

  const journal = selJournal ? selJournal.all(uid) : [];

  res.json({
    user,
    journal,
    payments: [] // compat futur
  });
});


// ==============================
// DELETE /api/account/
// ==============================
router.delete('/', requireAuth, (req, res) => {
  const uid = Number(req.user?.id);
  if (!Number.isFinite(uid)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (exists('journal_entries')) {
    db.prepare('DELETE FROM journal_entries WHERE userId = ?').run(uid);
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(uid);

  res.json({ ok: true });
});


// ==============================
// GET /api/account/legal/:doc
// ==============================
router.get('/legal/:doc', (req, res) => {
  const allowed = ['cgv', 'rgpd', 'mentions'];
  if (!allowed.includes(req.params.doc)) {
    return res.status(404).json({ error: 'Document introuvable' });
  }

  const docs = {
    cgv: {
      title: 'CGV',
      html: `
      <h1>Conditions Générales de Vente</h1>

      <p><strong>Éditeur</strong> : Bénédicte de Feuardent</p>

      <p>L'application <em>Ma Spiritualité</em> propose des fonctionnalités destinées
      à la réflexion personnelle, à la prière et à l’étude. Certaines fonctionnalités
      peuvent nécessiter l’achat de crédits ou de services complémentaires.</p>

      <h2>Prix et paiement</h2>
      <p>Les prix sont indiqués en euros, toutes taxes comprises.  
      Les paiements sont gérés par des prestataires sécurisés tels que Stripe.</p>

      <h2>Absence de garantie</h2>
      <p>L’application ne garantit pas une disponibilité permanente
      et peut être interrompue pour maintenance.</p>

      <h2>Droit de rétractation</h2>
      <p>Conformément à la législation en vigueur, le droit de rétractation ne s’applique
      pas aux services pleinement exécutés avant la fin du délai de rétractation.</p>
    `
  },
    rgpd: {
      title: 'RGPD',
      html: `
      <h1>Politique de Confidentialité</h1>

      <p><strong>Responsable du traitement</strong> : Bénédicte de Feuardent</p>

      <p>L'application collecte uniquement les données strictement nécessaires
      à son fonctionnement : adresse email, informations de compte,
      paramètres d’usage et notes personnelles enregistrées dans le carnet.</p>

      <h2>Finalités</h2>
      <ul>
        <li>Création et gestion du compte utilisateur</li>
        <li>Sécurisation des journaux et contenus personnels</li>
        <li>Utilisation de l’IA embarquée</li>
      </ul>

      <h2>Droits des utilisateurs</h2>
      <p>Vous pouvez demander l’export ou la suppression de toutes vos données
      directement dans l’application via la rubrique « Mon Compte ».</p>
    `
  },
    mentions: {
      title: 'Mentions légales',
      html: `
      <h1>Mentions légales</h1>

      <p><strong>Éditeur</strong> : Bénédicte de Feuardent<br>
      Adresse : disponible sur demande des autorités compétentes<br>
      Email : keryxidev@gmail.com</p>

      <p><strong>Hébergement</strong> : OVH (coordonnées complètes disponibles
      pour les autorités compétentes)</p>

      <p>Le contenu de l'application <em>Ma Spiritualité</em> est protégé par
      le droit d’auteur. Toute reproduction non autorisée est interdite.</p>

      <p>L'application n'a pas vocation à remplacer un conseil pastoral,
      psychologique ou médical.</p>
    `
  }
  };

  const doc = req.params.doc;
  res.json(docs[doc]);
});

// ==============================
// EXPORT
// ==============================
module.exports = router;
