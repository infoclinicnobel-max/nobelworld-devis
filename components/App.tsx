'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ToastHost } from './ui';
import { Login } from './Login';
import { Shell, type SyncState } from './Shell';
import { supabase, supabaseConfigured } from '@/lib/supabase/client';
import { AccesRefuseError, chargerProfil, chargerTout } from '@/lib/data';
import type { AppData } from '@/lib/types';
import type { AppUser } from '@/lib/perms';

/* =========================================================================
   RACINE DE L'APPLICATION
   Supabase remplace intégralement l'ancienne synchronisation maison :
   plus de safeMerge, plus d'instantané local par utilisateur, plus de
   sondage toutes les 15 s ni de délai d'attente de 45 s.
   ------------------------------------------------------------------------- */
export function App() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [data, setData] = useState<AppData | null>(null);
  const [booting, setBooting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [lastSync, setLastSync] = useState(0);
  const [refus, setRefus] = useState('');

  const refresh = useCallback(async (silent?: boolean): Promise<boolean> => {
    setSyncState('syncing');
    if (!silent) setLoading(true);
    try {
      const d = await chargerTout();
      setData(d);
      setSyncState('ok');
      setLastSync(Date.now());
      return true;
    } catch (e) {
      console.error('[CN][sync]', e);
      setSyncState(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error');
      return false;
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  /* Reprise de session : Supabase conserve la session et la rafraîchit seul. */
  useEffect(() => {
    if (!supabaseConfigured) {
      setRefus(
        "Configuration absente : les variables NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY ne sont pas définies sur cet environnement.",
      );
      setBooting(false);
      return;
    }
    let vivant = true;
    const sb = supabase();

    const appliquer = async (authUserId: string | undefined) => {
      if (!authUserId) {
        if (vivant) { setUser(null); setData(null); }
        return;
      }
      try {
        const profil = await chargerProfil(authUserId);
        if (!vivant) return;
        setUser(profil);
        setRefus('');
        await refresh();
      } catch (e) {
        if (!vivant) return;
        setUser(null);
        setData(null);
        setRefus((e as Error).message || 'Accès refusé');
        if (e instanceof AccesRefuseError) await sb.auth.signOut();
      }
    };

    sb.auth
      .getSession()
      .then(async ({ data: { session } }) => {
        await appliquer(session?.user?.id);
      })
      .finally(() => { if (vivant) setBooting(false); });

    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') { setUser(null); setData(null); }
      else if (event === 'SIGNED_IN' && session?.user?.id && !user) void appliquer(session.user.id);
    });

    return () => { vivant = false; sub.subscription.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Bannière hors-ligne : conservée à l'identique. */
  useEffect(() => {
    const goOn = () => { if (user) void refresh(true); };
    const goOff = () => setSyncState('offline');
    window.addEventListener('online', goOn);
    window.addEventListener('offline', goOff);
    return () => {
      window.removeEventListener('online', goOn);
      window.removeEventListener('offline', goOff);
    };
  }, [user, refresh]);

  const doLogin = async (email: string, password: string, _remember: boolean) => {
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
      await sb.auth.signOut();
      throw e;
    });
    setUser(profil);
    setRefus('');
    await refresh();
  };

  const logout = async () => {
    await supabase().auth.signOut();
    setUser(null);
    setData(null);
  };

  if (booting)
    return (
      <ToastHost>
        <div className="center-load"><span className="spin" /></div>
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
          <Login onLogin={doLogin} />
        </>
      </ToastHost>
    );

  if (!data)
    return (
      <ToastHost>
        <div className="center-load">
          <span className="spin" />
          <span className="muted">Synchronisation…</span>
        </div>
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
