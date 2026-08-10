'use client';

/* Lecture / écriture des cookies de session côté navigateur.
   ------------------------------------------------------------------------
   Pourquoi ne pas laisser @supabase/ssr s'en charger seul ? Parce qu'en 0.5.2
   il impose `maxAge: DEFAULT_COOKIE_OPTIONS.maxAge` et écrase toute valeur
   fournie (voir node_modules/@supabase/ssr/dist/main/cookies.js) :

       const setCookieOptions = {
         ...DEFAULT_COOKIE_OPTIONS, ...options?.cookieOptions,
         maxAge: DEFAULT_COOKIE_OPTIONS.maxAge,   // ← la nôtre est ignorée
       };

   Fournir nos propres `getAll` / `setAll` est le seul point d'accroche qui
   permette (a) d'honorer réellement la case « Rester connecté » et (b) de
   marquer les cookies `Secure` en HTTPS. L'encodage reproduit exactement celui
   du paquet `cookie` utilisé par la bibliothèque, pour que le middleware et le
   client serveur relisent les mêmes valeurs. */

export interface CookieAEcrire {
  name: string;
  value: string;
  options?: {
    maxAge?: number;
    path?: string;
    sameSite?: boolean | 'lax' | 'strict' | 'none';
    secure?: boolean;
    domain?: string;
    httpOnly?: boolean;
    expires?: Date;
  };
}

/** Durée maximale acceptée par les navigateurs pour un cookie : 400 jours. */
export const DUREE_MAXIMALE_S = 400 * 24 * 60 * 60;

export function lireCookies(): { name: string; value: string }[] {
  if (typeof document === 'undefined') return [];
  const brut = document.cookie;
  if (!brut) return [];
  const out: { name: string; value: string }[] = [];
  for (const morceau of brut.split(';')) {
    const i = morceau.indexOf('=');
    if (i < 0) continue;
    const name = morceau.slice(0, i).trim();
    let value = morceau.slice(i + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      value = decodeURIComponent(value);
    } catch {
      /* valeur non encodée : on la garde telle quelle */
    }
    out.push({ name, value });
  }
  return out;
}

function serialiser(name: string, value: string, o: CookieAEcrire['options'] = {}): string {
  let s = `${name}=${encodeURIComponent(value)}`;
  s += `; Path=${o.path || '/'}`;
  /* maxAge === undefined → cookie de session : il meurt à la fermeture du
     navigateur. C'est exactement ce que doit produire « Rester connecté »
     décoché, et ce qu'il ne faut JAMAIS produire quand elle est cochée. */
  if (typeof o.maxAge === 'number') {
    s += `; Max-Age=${Math.floor(o.maxAge)}`;
    s += `; Expires=${new Date(Date.now() + o.maxAge * 1000).toUTCString()}`;
  }
  if (o.domain) s += `; Domain=${o.domain}`;
  const ss = o.sameSite === true ? 'Strict' : o.sameSite || 'Lax';
  s += `; SameSite=${String(ss).charAt(0).toUpperCase() + String(ss).slice(1)}`;
  if (o.secure) s += '; Secure';
  return s;
}

export function ecrireCookies(liste: CookieAEcrire[], surcharge: CookieAEcrire['options']) {
  if (typeof document === 'undefined') return;
  for (const { name, value, options } of liste) {
    const o = { ...options, ...surcharge };
    /* Une suppression (maxAge 0) doit rester une suppression, quelle que soit
       la préférence de durée de session. */
    if (options && options.maxAge === 0) o.maxAge = 0;
    document.cookie = serialiser(name, value, o);
  }
}

/* ---------------------------------------------------------------------------
   Préférence « Rester connecté »
   Conservée dans son propre cookie, toujours longue durée : c'est le réglage
   de l'utilisateur, pas sa session. Elle doit être lisible AVANT la création
   du client Supabase, puisqu'elle en détermine le stockage.
   --------------------------------------------------------------------------- */
const CLE_MEMOIRE = 'nw_rester_connecte';

export function resterConnecte(): boolean {
  const c = lireCookies().find((x) => x.name === CLE_MEMOIRE);
  // Par défaut : oui. C'est l'attente métier — on ne déconnecte personne sans raison.
  return c ? c.value !== '0' : true;
}

export function definirResterConnecte(valeur: boolean) {
  ecrireCookies([{ name: CLE_MEMOIRE, value: valeur ? '1' : '0' }], {
    maxAge: DUREE_MAXIMALE_S,
    path: '/',
    sameSite: 'lax',
    secure: typeof location !== 'undefined' && location.protocol === 'https:',
  });
}
