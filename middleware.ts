import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

/* Rafraîchit le jeton Supabase à chaque navigation : sans cela, une session
   ouverte depuis plusieurs heures expirerait au rechargement de la page. */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  await supabase.auth.getUser();
  return response;
}

/* Le matcher doit couvrir TOUTES les pages : une page qui y échappe ne
   rafraîchit pas le cookie de session, et celle-ci s'éteint pendant que
   l'utilisateur la consulte.

   L'ancienne écriture excluait tout chemin finissant par .js / .json / .png…
   Elle fonctionnait pour l'unique page actuelle, mais aurait silencieusement
   exclu une future page dont l'URL se serait terminée ainsi. On énumère donc
   les seules exclusions légitimes — les ressources internes de Next et les
   fichiers PWA, qui ne doivent surtout pas être réécrits — et rien d'autre.
   Vérifié au banc d'essai : un chargement de « / » porteur d'un cookie
   déclenche bien un grant_type=refresh_token suivi de /auth/v1/user. */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|_next/webpack-hmr|favicon\\.ico|favicon\\.png|apple-touch-icon\\.png|icon-192\\.png|icon-512\\.png|icon-512-maskable\\.png|manifest\\.json|sw\\.js).*)',
  ],
};
