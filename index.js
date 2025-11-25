require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const listEndpoints = require('express-list-endpoints');

const app = express();
const port = process.env.PORT || 3013;

console.log('🚀 Démarrage du serveur Ma Spiritualité...');

// Proxy trust (Nginx)
app.set('trust proxy', 1);

// CORS
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true, credentials: true }));


// ============================
// AUTH — doit être AVANT les paiements
// ============================
try {
  const authCarnetRoute = require('./routes/auth.carnet');
  app.use('/api/auth', authCarnetRoute);
  console.log('✅ Route /api/auth chargée (PUBLIC)');
} catch (e) {
  console.log('⚠️ Route auth.carnet non disponible:', e.message);
}
// ============================
// Payments (router + webhook)
// ============================
const { router: paymentsRoute, stripeWebhookHandler } = require('./routes/payments');

// ============================
// IMPORT MISSING — ACCOUNT ROUTES
// ============================
const accountMe = require('./routes/account/account.me.js');
const accountPassword = require('./routes/account/account.password.js');
const accountCredits = require('./routes/account/account.credits.js');
const accountPrivacy = require('./routes/account/account.privacy.js');



// 1) Stripe Webhook AVANT bodyParser.json()
app.post(
  '/api/payments/stripe/webhook',
  express.raw({ type: 'application/json' }),
  stripeWebhookHandler
);

// 2) JSON parser pour toutes les autres routes
app.use(bodyParser.json({ limit: '1mb' }));

// 3) Routes paiements protégées (requireAuth)
app.use('/api/payments', (req, res, next) => {
  paymentsRoute(req, res, next);
});

// Rate limit global léger
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
}));

// Health early
app.get('/__boot', (_req, res) => res.json({ ok: true, via: '/__boot' }));
app.get('/__ping', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

console.log('📝 Montage des routes...');

// ===== ROUTES API =====
try {
  const liturgieRoute = require('./routes/liturgie');
  app.use('/api/liturgie', liturgieRoute);
  console.log('✅ Route /api/liturgie chargée');
} catch (e) { console.log('⚠️ Route liturgie non disponible:', e.message); }

try {
  const evangileRoute = require('./routes/evangile');
  app.use('/api/evangile', evangileRoute);
  console.log('✅ Route /api/evangile chargée');
} catch (e) { console.log('⚠️ Route evangile non disponible:', e.message); }

try {
  const paroleRoute = require('./routes/paroledujour');
  app.use('/api/paroledujour', paroleRoute);
  console.log('✅ Route /api/paroledujour chargée');
} catch (e) { console.log('⚠️ Route paroledujour non disponible:', e.message); }

try {
  const confessionRoute = require('./routes/confession');
  app.use('/api/confession', confessionRoute);
  console.log('✅ Route /api/confession chargée');
} catch (e) { console.log('⚠️ Route confession non disponible:', e.message); }

try {
  const priereRoute = require('./routes/priere');
  app.use('/api/priere', priereRoute);
  console.log('✅ Route /api/priere chargée');
} catch (e) { console.log('⚠️ Route prière non disponible:', e.message); }

// Journal sécurisé
let journalSecureRoute = null;
try {
  journalSecureRoute = require('./routes/journal_secure');
  app.use('/api/journal_secure', journalSecureRoute);
  console.log('Route /api/journal_secure chargée');
} catch (e) {
  console.log('Route journal_secure non disponible:', e.message);
}

if (journalSecureRoute) {
  app.use(
    '/api/journal',
    (req, _res, next) => {
      if (!req.url || req.url === '/' || req.url === '') {
        req.url = '/journal_secure/entries';
      } else {
        req.url = `/journal_secure${req.url}`;
      }
      next();
    },
    journalSecureRoute
  );
  console.log('Alias /api/journal redirigé vers journal_secure');
} else {
  console.log('Alias /api/journal inactif (journal_secure indisponible)');
}

try {
  const feedbackRoute = require('./routes/feedback');
  app.use('/api/feedback', feedbackRoute);
  console.log('✅ Route /api/feedback chargée');
} catch (e) { console.log('⚠️ Route feedback non disponible:', e.message); }

try {
  const enfantsRoute = require('./routes/enfants');
  app.use('/api/enfants', enfantsRoute);
  console.log('✅ Route /api/enfants chargée');
} catch (e) { console.log('⚠️ Route enfants non disponible:', e.message); }

// Account
app.use('/api/account', accountPrivacy);
app.use('/api/account', accountMe);
app.use('/api/account', accountPassword);
app.use('/api/account', accountCredits);

// Health
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/', (_req, res) => res.send('🌿 Backend Ma Spiritualité (SQLite) est en ligne.'));

// Debug
app.get('/api/_debug/routes', (_req, res) => {
  res.json(listEndpoints(app));
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.path });
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`✅ Serveur Ma Spiritualité démarré sur le port ${port}`);
});

module.exports = app;
