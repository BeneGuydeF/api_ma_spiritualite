require('dotenv').config();

const key = process.env.JOURNAL_ENCRYPTION_KEY;

console.log('✅ JOURNAL_ENCRYPTION_KEY détectée ?', !!key);
console.log('🔑 Longueur :', key?.length || 0);
if (key) {
  console.log('🧩 Aperçu (début) :', key.slice(0, 6) + '...');
} else {
  console.log("⚠️  Clé absente : vérifie ton fichier .env ou l'environnement système.");
}
