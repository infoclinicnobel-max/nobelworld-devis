'use client';

import { createBrowserClient } from '@supabase/ssr';
import {
  DUREE_MAXIMALE_S, ecrireCookies, lireCookies, resterConnecte, type CookieAEcrire,
} from './cookies';

/* Aucune clé en dur : tout passe par les variables d'environnement
   (.env.local en local, variables de projet côté Vercel). */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let cached: ReturnType<typeof createBrowserClient> | null = null;

export function supabase() {
  if (!url || !key) {
    throw new Error(
      "Configuration Supabase absente : renseignez NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  if (cached) return cached;

  const securise = typeof location !== 'undefined' && location.protocol === 'https:';

  cached = createBrowserClient(url, key, {
    auth: {
      /* Explicites plutôt qu'implicites : la session doit survivre à la
         fermeture de l'onglet, et le jeton se renouveler tout seul. Ce sont
         déjà les valeurs par défaut de @supabase/ssr — les écrire noir sur
         blanc évite qu'une mise à jour de la bibliothèque les change sans
         qu'on s'en aperçoive. */
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    cookies: {
      getAll() {
        return lireCookies();
      },
      setAll(liste: CookieAEcrire[]) {
        /* Cochée (défaut) : cookie persistant de 400 jours — le maximum accepté
           par les navigateurs. Décochée : cookie de session, effacé à la
           fermeture du navigateur. C'est ici, et nulle part ailleurs, que la
           case « Rester connecté » produit un effet réel. */
        ecrireCookies(liste, {
          path: '/',
          sameSite: 'lax',
          secure: securise,
          maxAge: resterConnecte() ? DUREE_MAXIMALE_S : undefined,
        });
      },
    },
  });
  return cached;
}

export const supabaseConfigured = !!url && !!key;
