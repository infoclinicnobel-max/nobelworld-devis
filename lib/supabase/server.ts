import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

/* Client Supabase côté serveur (Server Components / Route Handlers).
   L'application Nobel World rend l'essentiel côté navigateur ; ce client sert
   aux rendus serveur éventuels et garde la session cohérente entre les deux. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            /* appelé depuis un Server Component : le rafraîchissement de session
               est assuré par le middleware, on peut ignorer sans risque. */
          }
        },
      },
    },
  );
}
