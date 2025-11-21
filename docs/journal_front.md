# Journal sécurisé – guide front-end

Ce document décrit comment consommer l’API `journal_secure` depuis l’application front. L’objectif est d’unifier tous les écrans “Carnet/Journal” sur cette nouvelle pile (fin du mode mot de passe local).

---

## Authentification & headers

- **JWT obligatoire** : chaque requête doit envoyer `Authorization: Bearer <token>` (jeton obtenu via `/api/auth/carnet/login`).
- **CSRF** : aucune action supplémentaire si votre domaine fait partie des origines autorisées (`CORS_ORIGIN` côté back). Pas de token supplémentaire à gérer.
- **Pas de mot de passe journal** : le chiffrement se fait côté serveur, à l’aide de `JOURNAL_ENCRYPTION_KEY` + `encryptionSalt` utilisateur.

---

## Endpoints à utiliser

| Route                            | Méthode | Description                                   | Notes |
|---------------------------------|---------|-----------------------------------------------|-------|
| `/api/journal_secure/whoami`    | GET     | Infos utilisateur (id, email, crédits)        | À appeler après login pour hydrater l’UI |
| `/api/journal_secure/credits`   | GET     | Solde de crédits                              | Utilisé pour badges/CTA “recharger” |
| `/api/journal_secure/entries`   | GET     | Liste complète des entrées (contenu inclus)   | Pas de pagination côté back pour l’instant |
| `/api/journal_secure/entries/:id` | GET   | Détail d’une entrée                            | Même format qu’en liste |
| `/api/journal_secure/entries`   | POST    | Création d’une entrée                          | Consomme 1 crédit |

### Payload POST `/entries`
```jsonc
{
  "title": "string optionnel (défaut: \"Sans titre\")",
  "content": "string requis",
  "tags": ["string", ...] // optionnel, max 20 éléments
}
```

### Réponse POST
```json
{
  "ok": true,
  "entryId": 123,
  "title": "Mon titre",
  "credits": 4
}
```

### Codes d’erreur à gérer
- `400` : contenu manquant / identifiant invalide → afficher un message utilisateur.
- `401/403` : jeton absent ou expiré → forcer la reconnexion.
- `402` : crédits insuffisants → rediriger vers l’achat de crédits.
- `404` : entrée introuvable (supprimée ou appartenant à un autre utilisateur).
- `500` : erreur serveur générique → message “Réessayez plus tard”.

---

## Alias `/api/journal`

Le backend redirige désormais toutes les requêtes `/api/journal[...]` vers la nouvelle route sécurisée. Toutefois :

- Cette redirection est temporaire. Merci d’appeler directement `/api/journal_secure/...` dès que possible.
- Si vous détectez des comportements différents (ex. pagination), alignez-vous sur le format décrit ci-dessus : 
  - Liste complète renvoyée par défaut.
  - Pas de champ `password`.

---

## Gestion des crédits côté front

- Après chaque création (`POST /entries`), le backend renvoie le nouveau solde (`credits`). Mettez immédiatement à jour l’état global (badge, bouton désactivé si 0).
- Avant d’afficher le formulaire, vérifiez `req.user.credits` (via `/whoami` ou `/credits`) pour désactiver le CTA si le solde est nul.
- En cas de `402`, proposez un CTA “Ajouter des crédits” (vers `/api/payments/...` selon votre flow).

---

## Checklist migration front

1. **Récupérer le JWT** via `/api/auth/carnet/login` (inchangé).
2. **Appeler `/api/journal_secure/whoami`** au montage pour hydrater l’état utilisateur (id/email/credits).
3. **Remplacer tous les appels `/api/journal`** par les endpoints listés ci-dessus.
4. **Retirer les champs “mot de passe journal”** des formulaires (plus utilisés).
5. **Gérer les erreurs HTTP** (notamment 402) avec des messages UI adaptés.
6. **Tester** : création, lecture liste, lecture détail, absence de crédits, token expiré.
7. **Nettoyer** le code legacy une fois la bascule validée (plus d’appel à `/api/journal`).

---

## Besoins complémentaires ?

Contactez l’équipe backend si vous avez besoin :
- d’une pagination côté serveur,
- d’un endpoint “search” version secure,
- d’un champ supplémentaire renvoyé par `/entries` (ex. nombre de caractères, etc.).

Le backend est prêt ; à vous de jouer côté front 👊
