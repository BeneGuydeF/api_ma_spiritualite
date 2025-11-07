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

// JSON parser en amont de toutes les routes
app.use(bodyParser.json({ limit: '1mb' }));

// Rate limit global léger
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
}));

// Health très tôt
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

try {
  const authCarnetRoute = require('./routes/auth.carnet');
  app.use('/api/auth', authCarnetRoute);
  console.log('✅ Route /api/auth (auth.carnet.js) chargée');
} catch (e) {
  console.log('⚠️ Route auth.carnet non disponible:', e.message);
}

app.use('/api', require('./routes/journal_secure'));

try {
  const paymentsRoute = require('./routes/payments');
  app.use('/api/payments', paymentsRoute);
  console.log('✅ Route /api/payments chargée');
} catch (e) { console.log('⚠️ Route payments non disponible:', e.message); }

try {
  const carnetRoute = require('./routes/carnet'); 
  app.use('/api', carnetRoute);
  console.log('✅ Route /carnet* chargée');
} catch (e) {
  console.log('⚠️ Route carnet non disponible:', e.message);
}
try {
  const journalRoute = require('./routes/journal');
  app.use('/api/journal', journalRoute);
  console.log('✅ Route /api/journal chargée');
} catch (e) { console.log('⚠️ Route journal non disponible:', e.message); }

try {
  const donationsRoute = require('./routes/donations');
  app.use('/api/donations', donationsRoute);
  console.log('✅ Route /api/donations chargée');
} catch (e) { console.log('⚠️ Route donations non disponible:', e.message); }

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
