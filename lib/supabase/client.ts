'use client';

import { createBrowserClient } from '@supabase/ssr';

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
  if (!cached) cached = createBrowserClient(url, key);
  return cached;
}

export const supabaseConfigured = !!url && !!key;
