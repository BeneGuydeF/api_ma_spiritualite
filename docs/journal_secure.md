# Journal Secure – Rotation de clé

## Variables d’environnement

- `JOURNAL_ENCRYPTION_KEY` : clé AES dédiée (≥ 32 caractères). Obligatoire pour démarrer l’API.
- `JOURNAL_OLD_KEY` / `JOURNAL_NEW_KEY` : clés temporaires utilisées uniquement pendant la migration.

## Procédure de re-chiffrement

1. **Sauvegarde**  
   - Stopper l’API.  
   - Sauvegarder `data/ma_spiritualite.db`.

2. **Préparer les clés**  
   - Exporter l’ancienne clé `JOURNAL_OLD_KEY`.  
   - Générer une nouvelle clé forte (32 octets base64, par ex. via `openssl rand -base64 32`).  
   - Mettre cette nouvelle clé dans `.env` (`JOURNAL_NEW_KEY` et futur `JOURNAL_ENCRYPTION_KEY`).

3. **Migration**  
   ```bash
   JOURNAL_OLD_KEY="..." JOURNAL_NEW_KEY="..." node scripts/journal_rekey.js
   ```
   - Le script parcourt tous les utilisateurs, déchiffre les entrées avec l’ancienne clé + salt, puis les réécrit avec la nouvelle clé.
   - Le résumé affiche le nombre d’entrées migrées ou en échec.

4. **Validation**  
   - Relancer l’API avec `JOURNAL_ENCRYPTION_KEY` = nouvelle clé.  
   - Tester `POST /api/journal_secure/entries` et `GET /api/journal_secure/entries`.

5. **Nettoyage**  
   - Retirer `JOURNAL_OLD_KEY` et `JOURNAL_NEW_KEY` des environnements.  
   - Conserver la nouvelle clé dans le coffre (Vault, Secret Manager, etc.).

## Points d’attention

- Chaque utilisateur doit avoir un `encryptionSalt`. Si ce n’est pas le cas, lancer `scripts/migrate.js` ou regénérer le sel avant la migration.  
- Le script ne supprime pas les entrées en échec : corriger manuellement (par ex. si des données sont corrompues).  
- Toujours tester la migration sur un dump local avant de la lancer en production.
