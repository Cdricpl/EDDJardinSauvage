// ============================================================================
// Edge Function « create-user »
// ----------------------------------------------------------------------------
// Crée un compte employée SANS déconnecter l'administrateur.
// L'app appelle cette fonction (supabase.functions.invoke('create-user', …)).
//
// Sécurité : la fonction vérifie que l'APPELANT est un administrateur (via son
// jeton), puis crée le compte avec la clé service_role (jamais exposée au navigateur).
//
// Déploiement :
//   supabase functions deploy create-user
// (SUPABASE_URL, SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY sont fournis
//  automatiquement par l'environnement Supabase — rien à configurer.)
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // 1) Vérifier que l'appelant est authentifié et administrateur.
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader) return json({ error: 'Non authentifié.' }, 401);

    const asCaller = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await asCaller.auth.getUser();
    if (uErr || !user) return json({ error: 'Session invalide.' }, 401);

    const { data: prof } = await asCaller.from('profiles').select('role').eq('id', user.id).single();
    if (!prof || prof.role !== 'admin') return json({ error: 'Réservé à l\'administrateur.' }, 403);

    // 2) Valider les entrées.
    const { full_name, email, password } = await req.json().catch(() => ({}));
    if (!full_name || !email || !password || String(password).length < 6) {
      return json({ error: 'Nom, email et mot de passe (6+ caractères) requis.' }, 400);
    }

    // 3) Créer le compte avec la clé service_role (n'affecte pas la session de l'admin).
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name },
    });
    if (cErr) return json({ error: cErr.message }, 400);

    // Le trigger handle_new_user crée le profil (rôle 'employee' par défaut).
    return json({ user: created.user });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
