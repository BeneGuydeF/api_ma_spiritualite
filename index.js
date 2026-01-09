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

// ============================
// CORS
// ============================
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : true,
  credentials: true,
}));

// ============================
// Payments (router + webhook)
// ============================
const { router: paymentsRoute, stripeWebhookHandler } = require('./routes/payments');

// ⚠️ Webhook Stripe AVANT bodyParser.json()
app.post(
  '/api/payments/stripe/webhook',
  express.raw({ type: 'application/json' }),
  stripeWebhookHandler
);

// ============================
// JSON parser global
// ============================
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// ============================
// Rate limit global
// ============================
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
}));

// ============================
// AUTH (PUBLIC)
// ============================
try {
  const authCarnetRoute = require('./routes/auth.carnet');
  app.use('/api/auth', authCarnetRoute);
  console.log('✅ Route /api/auth chargée (PUBLIC)');
} catch (e) {
  console.log('⚠️ Route auth.carnet non disponible:', e.message);
}

// ============================
// ACCOUNT ROUTES
// ============================
try {
  const accountMe = require('./routes/account/account.me.js');
  const accountPassword = require('./routes/account/account.password.js');
  const accountCredits = require('./routes/account/account.credits.js');
  const accountPrivacy = require('./routes/account/account.privacy.js');
   const accountSignup = require('./routes/auth.signup');

  app.use('/api/account', accountMe);
    app.use('/api/account', accountSignup);
  app.use('/api/account', accountPassword);
  app.use('/api/account', accountCredits);
  app.use('/api/account', accountPrivacy);

  console.log('✅ Routes /api/account/* montées');
} catch (e) {
  console.log('⚠️ Routes /api/account non disponibles:', e.message);
}

// ============================
// Health checks (tôt)
// ============================
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
  app.use('/api/confession', confessionRoute); // POST '/'
  console.log('✅ Route /api/confession chargée');
} catch (e) { console.log('⚠️ Route confession non disponible:', e.message); }

try {
  const priereRoute = require('./routes/priere');
  app.use('/api/priere', priereRoute); // POST '/'
  console.log('✅ Route /api/priere chargée');
} catch (e) { console.log('⚠️ Route prière non disponible:', e.message); }

// Journal secure (monté sur /api)
let journalSecureRoute = null;
try {
  journalSecureRoute = require('./routes/journal_secure');
  app.use('/api', journalSecureRoute);;
  console.log('✅ Route /api/journal_secure chargée');
} catch (e) {
  console.log('⚠️ Route journal_secure non disponible:', e.message);
}

// Alias /api/journal → /api/journal_secure
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
  console.log('✅ Alias /api/journal redirigé vers journal_secure');
} else {
  console.log('ℹ️ Alias /api/journal inactif (journal_secure indisponible)');
}

// Carnet
try {
  const carnetRoute = require('./routes/carnet');
  app.use('/api', carnetRoute);
  console.log('✅ Route /carnet* chargée');
} catch (e) {
  console.log('⚠️ Route carnet non disponible:', e.message);
}

// Donations
try {
  const donationsRoute = require('./routes/donations');
  app.use('/api/donations', donationsRoute);
  console.log('✅ Route /api/donations chargée');
} catch (e) { console.log('⚠️ Route donations non disponible:', e.message); }

// Feedback
try {
  const feedbackRoute = require('./routes/feedback');
  app.use('/api/feedback', feedbackRoute);
  console.log('✅ Route /api/feedback chargée');
} catch (e) { console.log('⚠️ Route feedback non disponible:', e.message); }

// Enfants
try {
  const enfantsRoute = require('./routes/enfants');
  app.use('/api/enfants', enfantsRoute);
  console.log('✅ Route /api/enfants chargée');
} catch (e) { console.log('⚠️ Route enfants non disponible:', e.message); }

// Payments (router) — après auth/json parser
app.use('/api/payments', paymentsRoute);

// Health simple
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/', (_req, res) => res.send('🌿 Backend Ma Spiritualité (SQLite) est en ligne.'));

// Debug routes (fiable)
app.get('/api/_debug/routes', (_req, res) => {
  res.json(listEndpoints(app));
});

// 404 lisible (après toutes les routes)
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.path });
});

// Démarrage
app.listen(port, '0.0.0.0', () => {
  console.log(`✅ Serveur Ma Spiritualité démarré sur le port ${port}`);
  console.log('🎯 Routes disponibles:');
  console.log('  - POST /api/priere');
  console.log('  - POST /api/confession');
  console.log('  - POST /api/enfants');
  console.log('  - GET  /api/evangile');
  console.log('  - GET  /api/paroledujour');
  console.log('  - GET  /api/liturgie');
  console.log('  - GET  /health');
  console.log('  - GET  /');
});

module.exports = app;
