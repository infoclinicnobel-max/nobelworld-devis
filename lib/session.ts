'use client';

import { useEffect, useRef } from 'react';
import { supabase } from './supabase/client';

/* =========================================================================
   MAINTIEN DE LA SESSION
   -------------------------------------------------------------------------
   Ce que la bibliothèque fait déjà : un minuteur toutes les 30 s renouvelle le
   jeton quand il arrive à moins de 90 s de son expiration, et un écouteur
   `visibilitychange` relance ce minuteur.

   Ce qu'elle ne fait pas, et qui explique le symptôme rapporté :
   – quand l'onglet passe en arrière-plan, le navigateur ralentit puis gèle les
     minuteurs ; au réveil, aucun rattrapage n'est forcé ;
   – si un renouvellement a échoué pendant l'absence (portable en veille, wifi
     coupé), auth-js s'impose un délai de garde d'une minute avant de réessayer.
     Pendant ce temps l'application paraît connectée avec un jeton mort, et la
     première action de l'utilisateur échoue.

   Mesuré sur banc d'essai avant correction : revenir sur l'onglet avec un jeton
   périmé déclenchait ZÉRO renouvellement.

   D'où ce garde-fou : à chaque retour de l'utilisateur (visibilité, focus,
   retour du réseau) et à intervalle régulier, on relance explicitement le
   renouvellement automatique et on répare la session si le jeton est expiré ou
   sur le point de l'être.
   ========================================================================= */

/** On renouvelle dès que le jeton entre dans cette fenêtre avant expiration. */
const MARGE_S = 10 * 60;
/** Filet de sécurité pendant que l'onglet est au premier plan. */
const PERIODE_MS = 4 * 60 * 1000;
/** Deux réparations rapprochées ne servent à rien et martèlent le serveur. */
const ANTI_REBOND_MS = 3000;

export type ResultatReparation = 'inutile' | 'renouvele' | 'aucune-session' | 'echec';

/**
 * Vérifie la session et renouvelle le jeton s'il est expiré ou proche de l'être.
 * Ne déconnecte jamais : un échec est signalé, pas sanctionné.
 */
export async function reparerSession(): Promise<ResultatReparation> {
  const sb = supabase();
  const { data, error } = await sb.auth.getSession();
  if (error) return 'echec';
  const session = data.session;
  if (!session) return 'aucune-session';

  const expireA = Number(session.expires_at || 0);
  const restant = expireA - Math.floor(Date.now() / 1000);
  if (restant > MARGE_S) return 'inutile';

  const { data: neuf, error: err } = await sb.auth.refreshSession();
  if (err || !neuf.session) {
    console.warn('[CN][session] renouvellement impossible pour le moment :', err?.message);
    return 'echec';
  }
  return 'renouvele';
}

/**
 * Branche le maintien de session sur les évènements de retour de l'utilisateur.
 * `onRepare` est appelé quand un jeton réellement périmé vient d'être renouvelé :
 * c'est le bon moment pour recharger les données affichées.
 */
export function useMaintienSession(actif: boolean, onRepare: () => void) {
  const dernier = useRef(0);
  const rappel = useRef(onRepare);
  rappel.current = onRepare;

  useEffect(() => {
    if (!actif) return;
    const sb = supabase();
    let vivant = true;

    const reparer = async (raison: string) => {
      const maintenant = Date.now();
      if (maintenant - dernier.current < ANTI_REBOND_MS) return;
      dernier.current = maintenant;
      const r = await reparerSession();
      if (!vivant) return;
      if (r === 'renouvele') {
        console.info('[CN][session] jeton renouvelé au retour (' + raison + ')');
        rappel.current();
      }
    };

    const auRetour = (raison: string) => () => {
      /* startAutoRefresh est prévu exactement pour ça : redémarrer le minuteur
         que le navigateur a gelé pendant que l'onglet était en arrière-plan. */
      void sb.auth.startAutoRefresh();
      void reparer(raison);
    };

    const surVisibilite = () => {
      if (document.visibilityState === 'visible') auRetour('visibilité')();
      else void sb.auth.stopAutoRefresh();
    };

    const surFocus = auRetour('focus');
    const surReseau = auRetour('retour du réseau');

    document.addEventListener('visibilitychange', surVisibilite);
    window.addEventListener('focus', surFocus);
    window.addEventListener('online', surReseau);
    /* Sur mobile, un onglet restauré depuis le cache arrière/avant ne déclenche
       pas toujours `visibilitychange` : `pageshow` couvre ce cas. */
    window.addEventListener('pageshow', surFocus);

    const minuteur = setInterval(() => {
      if (document.visibilityState === 'visible') void reparer('contrôle périodique');
    }, PERIODE_MS);

    // Au montage : on part d'une session saine.
    void sb.auth.startAutoRefresh();
    void reparer('démarrage');

    return () => {
      vivant = false;
      clearInterval(minuteur);
      document.removeEventListener('visibilitychange', surVisibilite);
      window.removeEventListener('focus', surFocus);
      window.removeEventListener('online', surReseau);
      window.removeEventListener('pageshow', surFocus);
    };
  }, [actif]);
}

/* =========================================================================
   Réessais sur erreur passagère
   ========================================================================= */

/** Une panne réseau ou un 5xx sont passagers ; un refus d'accès ne l'est pas. */
export function estPassagere(e: unknown): boolean {
  const m = String((e as Error)?.message || e || '').toLowerCase();
  if (!m) return true;
  return (
    m.includes('failed to fetch') || m.includes('networkerror') || m.includes('load failed') ||
    m.includes('fetch failed') || m.includes('timeout') || m.includes('timed out') ||
    m.includes('network') || m.includes('abort') ||
    m.includes('502') || m.includes('503') || m.includes('504') ||
    m.includes('service unavailable') || m.includes('gateway')
  );
}

/** Paliers d'attente entre deux tentatives, en millisecondes. */
export const PALIERS_MS = [2000, 4000, 8000, 15000, 30000];
export const paliere = (essai: number) => PALIERS_MS[Math.min(essai, PALIERS_MS.length - 1)];
