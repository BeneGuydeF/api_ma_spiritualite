#!/usr/bin/env node
/**
 * scripts/journal_rekey.js
 * Outil de migration pour rechiffrer toutes les entrées du journal sécurisé
 * lorsqu'on change de clé JOURNAL_ENCRYPTION_KEY.
 *
 * Utilisation:
 *   JOURNAL_OLD_KEY=... JOURNAL_NEW_KEY=... node scripts/journal_rekey.js
 *
 * Le script parcourt chaque utilisateur, déchiffre les entrées avec l'ancienne
 * clé + leur salt, puis les rechiffre avec la nouvelle clé.
 */

require('dotenv').config();

const db = require('../db/sqlite');
const userRepo = require('../models/user.repo');
const journalRepo = require('../models/journal.repo');
const { decrypt, decryptJSON, encrypt, encryptJSON } = require('../utils/crypto');

const OLD_KEY = process.env.JOURNAL_OLD_KEY || process.env.JOURNAL_ENCRYPTION_KEY;
const NEW_KEY = process.env.JOURNAL_NEW_KEY;

if (!OLD_KEY || OLD_KEY.length < 32) {
  console.error('❌ JOURNAL_OLD_KEY manquant ou trop court (min 32 caractères)');
  process.exit(1);
}
if (!NEW_KEY || NEW_KEY.length < 32) {
  console.error('❌ JOURNAL_NEW_KEY manquant ou trop court (min 32 caractères)');
  process.exit(1);
}
if (OLD_KEY === NEW_KEY) {
  console.warn('ℹ️  Clé identique fournie en entrée/sortie. Aucune migration nécessaire.');
  process.exit(0);
}

const listUsers = db.prepare('SELECT id, encryptionSalt FROM users WHERE encryptionSalt IS NOT NULL').all();

let updatedEntries = 0;
let failedEntries = 0;

for (const user of listUsers) {
  const entries = journalRepo.getAllWithContent(user.id);
  if (!entries.length) continue;

  for (const entry of entries) {
    try {
      const encryptedContent = entry.encryptedContent && JSON.parse(entry.encryptedContent);
      if (!encryptedContent) continue;

      const plaintext = decrypt(
        encryptedContent.encryptedData,
        encryptedContent.iv,
        encryptedContent.tag,
        OLD_KEY,
        user.encryptionSalt,
      );

      let tags = [];
      if (entry.encryptedTags) {
        const parsedTags = JSON.parse(entry.encryptedTags);
        tags = decryptJSON(
          parsedTags.encryptedData,
          parsedTags.iv,
          parsedTags.tag,
          OLD_KEY,
          user.encryptionSalt,
        );
      }

      const newEncryptedContent = encrypt(plaintext, NEW_KEY, user.encryptionSalt);
      const newEncryptedTags = tags.length ? encryptJSON(tags, NEW_KEY, user.encryptionSalt) : null;

      journalRepo.update(entry.id, user.id, {
        title: entry.title,
        encryptedContent: JSON.stringify(newEncryptedContent),
        encryptedTags: newEncryptedTags ? JSON.stringify(newEncryptedTags) : null,
        iv: newEncryptedContent.iv,
      });
      updatedEntries += 1;
    } catch (err) {
      failedEntries += 1;
      console.error(
        `❌ Migration échouée pour user=${user.id} entry=${entry.id}: ${err.message || err}`,
      );
    }
  }
}

console.log(
  `🎯 Migration terminée. Entrées mises à jour: ${updatedEntries}. Échecs: ${failedEntries}.`,
);
