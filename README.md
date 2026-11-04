# Portfolio — inscriptions et espace d’administration

Le portfolio, son formulaire d’inscription et son administration doivent être déployés ensemble depuis ce dépôt, à la racine du projet. L’administration est disponible sur `/admin.html` et utilise `/api/admin` sur le même domaine. Cette configuration est nécessaire au fonctionnement de la session sécurisée.

## Configuration

1. Créer un projet Supabase et exécuter [`schema.sql`](./schema.sql) dans le SQL Editor.
2. Dans Vercel, ouvrir **Settings > Environment Variables** pour le projet qui déploie ce dépôt, et définir :
   - `SUPABASE_SERVICE_KEY` : clé secrète Supabase (`service_role` ou `sb_secret_...`). Ne jamais l’exposer dans le navigateur.
   - `ADMIN_PASSWORD` : mot de passe admin long et unique.
   - `SESSION_SECRET` : secret aléatoire d’au moins 32 caractères.
   - `SUPABASE_URL` : URL du projet Supabase. Si elle est omise, le code utilise l’URL par défaut configurée dans `api/_lib.js`.
   - `RESEND_API_KEY` : facultatif ; active les notifications par e-mail via Resend.
   - `RESEND_FROM_EMAIL` : facultatif ; expéditeur Resend. Sans domaine vérifié, utiliser l’expéditeur de test autorisé par le compte Resend.
   - `NOTIFY_EMAIL` : facultatif ; adresse qui reçoit les notifications. Par défaut : `anarouachamsoudine010@gmail.com`.
3. Redéployer après avoir ajouté ou modifié les variables.
4. Tester une inscription, puis ouvrir `/admin.html`, se connecter et vérifier que l’inscription apparaît.

L’inscription est enregistrée dans Supabase. Les notifications e-mail sont facultatives : une panne de Resend ne bloque pas une inscription enregistrée dans la base. Si la base n’est pas configurée, l’e-mail Resend peut servir de canal de secours lorsque `RESEND_API_KEY` est défini.

Les clés et mots de passe doivent rester dans les variables d’environnement Vercel, jamais dans Git ou dans le code client. Si une clé a été exposée, la révoquer et la renouveler.

## Dépannage

- **Admin non configuré** : vérifier `ADMIN_PASSWORD` et `SESSION_SECRET`.
- **Base non configurée** : vérifier `SUPABASE_SERVICE_KEY`, l’URL Supabase et l’exécution de `schema.sql`.
- **Notification absente** : vérifier `RESEND_API_KEY`, l’expéditeur autorisé dans Resend et les journaux Vercel.
- Consulter les journaux des fonctions Vercel `/api/admin` et `/api/inscription` pour les erreurs serveur.

`admin-portefolio` est un dépôt distinct et n’est pas utilisé par cette architecture : garder l’admin et son API sur le même domaine évite les problèmes de cookies de session inter-domaines.
