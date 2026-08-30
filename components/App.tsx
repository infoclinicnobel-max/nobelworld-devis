'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ToastHost } from './ui';
import { Ico } from './icons';
import { Login } from './Login';
import { Shell, type SyncState } from './Shell';
import { supabase, supabaseConfigured } from '@/lib/supabase/client';
import { definirResterConnecte, resterConnecte } from '@/lib/supabase/cookies';
import { AccesRefuseError, chargerProfil, chargerTout } from '@/lib/data';
import { estPassagere, paliere, useMaintienSession } from '@/lib/session';
import type { AppData } from '@/lib/types';
import type { AppUser } from '@/lib/perms';

/* =========================================================================
   RACINE DE L'APPLICATION
   Supabase remplace intégralement l'ancienne synchronisation maison :
   plus de safeMerge, plus d'instantané local par utilisateur, plus de
   sondage toutes les 15 s ni de délai d'attente de 45 s.

   Règle de conduite sur les erreurs — la plus importante de ce fichier :
   une panne réseau, un 502 ou une requête interrompue NE DOIVENT JAMAIS
   renvoyer l'utilisateur à l'écran de connexion. Sa session reste valide ;
   on réessaie. Seul un refus d'accès explicite (profil absent, rôle interdit,
   compte désactivé) met fin à la session.
   ------------------------------------------------------------------------- */

/** Ce qui empêche l'application de démarrer, et si c'est réparable tout seul. */
type Blocage = { message: string; passagere: boolean; essai: number } | null;

export function App() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [data, setData] = useState<AppData | null>(null);
  const [booting, setBooting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [lastSync, setLastSync] = useState(0);
  const [refus, setRefus] = useState('');
  const [blocage, setBlocage] = useState<Blocage>(null);
  /* Une session Supabase valide existe-t-elle ? C'est distinct de « le profil est
     chargé » : tant qu'une session est là, on ne montre JAMAIS l'écran de
     connexion, même si le profil ou les données ne répondent pas. */
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);

  /* `user` lu depuis des fermetures créées au montage : une référence évite de
     travailler sur une valeur périmée (l'ancien test `!user` était toujours vrai). */
  const userRef = useRef<AppUser | null>(null);
  userRef.current = user;
  const reprise = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* Verrou de ré-entrance : sans lui, chaque TOKEN_REFRESHED relance un
     chargement, qui déclenche un renouvellement, qui relance un chargement…
     Mesuré sur banc avant ce verrou : 1 647 renouvellements en 20 s de panne. */
  const enCours = useRef(false);
  const vivant = useRef(true);

  const annulerReprise = () => {
    if (reprise.current) { clearTimeout(reprise.current); reprise.current = null; }
  };

  const refresh = useCallback(async (silent?: boolean): Promise<boolean> => {
    setSyncState('syncing');
    if (!silent) setLoading(true);
    try {
      const d = await chargerTout();
      if (!vivant.current) return true;
      setData(d);
      setSyncState('ok');
      setLastSync(Date.now());
      setBlocage(null);
      return true;
    } catch (e) {
      console.error('[CN][sync]', e);
      if (!vivant.current) return false;
      setSyncState(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error');
      return false;
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  /* Charge le profil puis les données. En cas d'échec passager, la session est
     CONSERVÉE et une nouvelle tentative est programmée : on ne renvoie jamais
     quelqu'un à l'écran de connexion pour une coupure de trois secondes. */
  const ouvrirSession = useCallback(
    async (authUserId: string, essai = 0): Promise<void> => {
      if (enCours.current) return;
      enCours.current = true;
      annulerReprise();
      try {
        const profil = await chargerProfil(authUserId);
        if (!vivant.current) return;
        setUser(profil);
        setRefus('');
        setBlocage(null);
        const ok = await refresh();
        if (!ok && vivant.current) {
          /* Session valide, données inaccessibles : on réessaie sans rien perdre. */
          setBlocage({
            message: 'Les données ne répondent pas. Votre session reste ouverte.',
            passagere: true,
            essai,
          });
          reprise.current = setTimeout(() => void ouvrirSession(authUserId, essai + 1), paliere(essai));
        }
      } catch (e) {
        if (!vivant.current) return;
        if (e instanceof AccesRefuseError) {
          // Refus explicite : là, et seulement là, on met fin à la session.
          setSessionUserId(null);
          setUser(null);
          setData(null);
          setBlocage(null);
          setRefus((e as Error).message);
          await supabase().auth.signOut();
          return;
        }
        if (estPassagere(e)) {
          console.warn('[CN][session] échec passager, la session est conservée :', (e as Error).message);
          setBlocage({
            message: 'Connexion au serveur impossible pour le moment. Votre session reste ouverte.',
            passagere: true,
            essai,
          });
          reprise.current = setTimeout(() => void ouvrirSession(authUserId, essai + 1), paliere(essai));
          return;
        }
        // Erreur durable et non identifiée : on informe, sans détruire la session.
        setBlocage({ message: (e as Error).message || 'Erreur inattendue', passagere: false, essai });
      } finally {
        enCours.current = false;
      }
    },
    [refresh],
  );

  /** Relance un chargement seulement si rien n'est déjà en cours ni programmé. */
  const ouvrirSiRepos = useCallback(
    (authUserId: string) => {
      if (userRef.current || enCours.current || reprise.current) return;
      void ouvrirSession(authUserId);
    },
    [ouvrirSession],
  );

  /* Reprise de session : Supabase conserve la session et la rafraîchit seul. */
  useEffect(() => {
    vivant.current = true;
    if (!supabaseConfigured) {
      setRefus(
        "Configuration absente : les variables NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY ne sont pas définies sur cet environnement.",
      );
      setBooting(false);
      return;
    }
    const sb = supabase();

    sb.auth
      .getSession()
      .then(async ({ data: { session } }) => {
        if (session?.user?.id) {
          setSessionUserId(session.user.id);
          await ouvrirSession(session.user.id);
        }
      })
      .catch((e) => {
        /* Même ici, pas d'éjection : sans session lisible on affiche simplement
           l'écran de connexion, mais une erreur de lecture n'efface rien. */
        console.error('[CN][session] lecture de la session impossible', e);
      })
      .finally(() => { if (vivant.current) setBooting(false); });

    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        annulerReprise();
        enCours.current = false;
        setSessionUserId(null);
        setUser(null);
        setData(null);
        setBlocage(null);
        return;
      }
      const id = session?.user?.id;
      if (!id) return;
      setSessionUserId(id);
      /* TOKEN_REFRESHED, SIGNED_IN, INITIAL_SESSION : on note que la session est
         vivante, et on ne relance un chargement QUE si rien n'est en cours ni
         déjà programmé. Un renouvellement de jeton ne doit jamais, à lui seul,
         redéclencher un cycle de chargement. */
      ouvrirSiRepos(id);
    });

    return () => {
      vivant.current = false;
      annulerReprise();
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Renouvellement forcé au retour de l'utilisateur (onglet, focus, réseau).
     Actif dès qu'une session existe — y compris pendant l'écran de reprise,
     où c'est justement le retour de l'utilisateur qui doit relancer la machine. */
  useMaintienSession(!!sessionUserId || !!user, () => {
    if (userRef.current) void refresh(true);
    else if (sessionUserId) ouvrirSiRepos(sessionUserId);
  });

  /* Bannière hors-ligne : conservée à l'identique. */
  useEffect(() => {
    const goOn = () => { if (userRef.current) void refresh(true); };
    const goOff = () => setSyncState('offline');
    window.addEventListener('online', goOn);
    window.addEventListener('offline', goOff);
    return () => {
      window.removeEventListener('online', goOn);
      window.removeEventListener('offline', goOff);
    };
  }, [refresh]);

  const doLogin = async (email: string, password: string, remember: boolean) => {
    setSessionUserId(null);
    /* Écrit AVANT la connexion : c'est cette préférence que le client Supabase
       consulte pour décider de la durée de vie des cookies qu'il va poser. */
    definirResterConnecte(remember);
    const sb = supabase();
    const { data: res, error } = await sb.auth.signInWithPassword({
      email: String(email).trim(),
      password,
    });
    if (error) {
      throw new Error(
        /invalid login/i.test(error.message) ? 'Identifiant ou mot de passe incorrect' : error.message,
      );
    }
    const profil = await chargerProfil(res.user.id).catch(async (e) => {
      /* À la connexion seulement : si le profil est refusé, on referme. Une
         panne passagère, elle, laisse la session ouverte et sera reprise. */
      if (e instanceof AccesRefuseError) await sb.auth.signOut();
      throw e;
    });
    setSessionUserId(res.user.id);
    setUser(profil);
    setRefus('');
    setBlocage(null);
    await refresh();
  };

  const logout = async () => {
    annulerReprise();
    enCours.current = false;
    setSessionUserId(null);
    await supabase().auth.signOut();
    setUser(null);
    setData(null);
    setBlocage(null);
  };

  if (booting)
    return (
      <ToastHost>
        <div className="center-load"><span className="spin" /></div>
      </ToastHost>
    );

  /* Session valide mais profil pas encore chargé : écran de reprise, jamais
     l'écran de connexion — l'utilisateur n'a aucune raison de ressaisir quoi
     que ce soit, son jeton est parfaitement bon. */
  if (!user && sessionUserId)
    return (
      <ToastHost>
        <EcranReprise
          blocage={blocage}
          onReessayer={() => { annulerReprise(); void ouvrirSession(sessionUserId); }}
          onQuitter={logout}
        />
      </ToastHost>
    );

  if (!user)
    return (
      <ToastHost>
        <>
          {refus && (
            <div className="syncwarn" role="alert" style={{ textAlign: 'center' }}>
              ⚠ {refus}
            </div>
          )}
          <Login onLogin={doLogin} resterConnecteParDefaut={resterConnecte()} />
        </>
      </ToastHost>
    );

  /* Session ouverte mais données pas encore là : on attend ou on réessaie —
     jamais l'écran de connexion. L'utilisateur garde sa session. */
  if (!data)
    return (
      <ToastHost>
        <EcranReprise
          blocage={blocage}
          onReessayer={() => { annulerReprise(); if (sessionUserId) void ouvrirSession(sessionUserId); }}
          onQuitter={logout}
        />
      </ToastHost>
    );

  return (
    <ToastHost>
      <Shell
        user={user}
        data={data}
        setData={setData}
        refresh={refresh}
        logout={logout}
        loading={loading}
        syncState={syncState}
        lastSync={lastSync}
      />
    </ToastHost>
  );
}

/* Écran d'attente / de reprise. Volontairement sobre et rassurant : le message
   central est que la session n'est pas perdue. */
function EcranReprise({
  blocage, onReessayer, onQuitter,
}: { blocage: Blocage; onReessayer: () => void; onQuitter: () => void }) {
  if (!blocage)
    return (
      <div className="center-load">
        <span className="spin" />
        <span className="muted">Synchronisation…</span>
      </div>
    );
  return (
    <div className="center-load">
      <div className="card card-pad" style={{ maxWidth: 460, textAlign: 'center' }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>
          {blocage.passagere ? 'Reconnexion en cours…' : 'Problème inattendu'}
        </div>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, margin: '0 0 6px' }}>{blocage.message}</p>
        {blocage.passagere && (
          <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, margin: '0 0 14px' }}>
            Vous n&apos;avez pas été déconnecté : dès que le serveur répond, l&apos;application repart toute
            seule. Tentative n° {blocage.essai + 1}.
          </p>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={onReessayer}>
            <Ico.hist size={15} />Réessayer maintenant
          </button>
          <button className="btn btn-ghost" onClick={onQuitter}>Se déconnecter</button>
        </div>
      </div>
    </div>
  );
}
