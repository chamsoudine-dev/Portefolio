# Portfolio — inscriptions + espace admin

## Ce qui a été corrigé
- Les inscriptions échouaient très probablement car RESEND_API_KEY / RESEND_FROM_EMAIL n'étaient pas définies ou l'expéditeur n'était pas valide : l'API renvoyait une erreur et l'utilisateur ne voyait que « L'envoi a échoué ».
- Chaque inscription est maintenant enregistrée dans une base (Supabase) ET notifiée par e-mail. Une panne de l'un des deux n'empêche plus l'inscription.
- Nouvel espace admin : /admin.html (inscrits, statuts, notes, tâches, export CSV).

## Mise en place (15 min)
1. **Supabase** (gratuit) : créer un projet, ouvrir SQL Editor, exécuter `schema.sql`.
   Settings > API : copier l'URL du projet et la clé `service_role` (secrète).
2. **Vercel** > projet > Settings > Environment Variables (Production) :
   - SUPABASE_URL = https://xeztwmpmnxmmuxzfqmph.supabase.co (déjà par défaut dans le code)
   - SUPABASE_SERVICE_KEY = clé secrète (sb_secret_... ou service_role), PAS la clé publishable
   - ADMIN_PASSWORD = un mot de passe long et unique
   - SESSION_SECRET = chaîne aléatoire de 32+ caractères
   - RESEND_API_KEY = clé Resend (facultatif)
   - RESEND_FROM_EMAIL = laisser vide pour utiliser `onboarding@resend.dev` (fonctionne uniquement si le compte Resend a été créé avec l'e-mail destinataire anarouachamsoudine010@gmail.com ; aucun domaine requis dans ce cas)
3. Redéployer (Deployments > Redeploy), puis tester : s'inscrire sur le site, ouvrir /admin.html.

Ne jamais mettre ces clés dans GitHub ni dans le chat. Si une clé a déjà été partagée, la régénérer.
