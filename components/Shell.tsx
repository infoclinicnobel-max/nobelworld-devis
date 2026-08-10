'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Empty, ErrorBoundary, Modal, OverlayCtx, useToast } from './ui';
import { Ico, type IconType } from './icons';
import { AppCtx, type AppCtxValue } from './AppContext';
import { Dashboard } from './Dashboard';
import { SearchResults } from './SearchResults';
import { PatientsView } from './Patients';
import { DevisView } from './Devis';
import { FacturesView } from './Factures';
import { PaiementsView } from './Paiements';
import { HistoriqueView, ModelesView, OptionsView } from './Bibliotheque';
import { ParametresView } from './Parametres';
import { UtilisateursView } from './Utilisateurs';
import { SIDEBAR_LOGO } from '@/lib/logos';
import { fmtClock, initials } from '@/lib/format';
import { can, canView, isAdmin, ROLES, userLabel, type AppUser } from '@/lib/perms';
import * as db from '@/lib/data';
import type { AppData, Collection } from '@/lib/types';
import type { Settings } from '@/lib/defaults';

const NAV: { k?: string; label?: string; icon?: IconType; sec?: string; adminOnly?: boolean }[] = [
  { k: 'dashboard', label: 'Tableau de bord', icon: Ico.dash },
  { k: 'devis', label: 'Devis', icon: Ico.doc },
  { k: 'factures', label: 'Factures', icon: Ico.invoice },
  { k: 'paiements', label: 'Paiements', icon: Ico.wallet },
  { k: 'patients', label: 'Patients', icon: Ico.patient },
  { sec: 'Bibliothèque' },
  { k: 'modeles', label: 'Modèles de devis', icon: Ico.tpl },
  { k: 'options', label: 'Options', icon: Ico.plus },
  { sec: 'Système' },
  { k: 'utilisateurs', label: 'Utilisateurs', icon: Ico.users, adminOnly: true },
  { k: 'historique', label: 'Historique', icon: Ico.hist },
  { k: 'parametres', label: 'Paramètres', icon: Ico.cog },
];

export type SyncState = 'idle' | 'syncing' | 'ok' | 'error' | 'offline';

function SyncPill({ state, lastSync }: { state: SyncState; lastSync: number }) {
  const map: Record<string, [string, string]> = {
    idle: ['Prêt', '#8aa0b6'], syncing: ['Synchronisation…', '#c08a2b'], ok: ['Synchronisé', '#2e9e6b'],
    error: ['Erreur de sync', '#c0392b'], offline: ['Hors ligne', '#c0392b'],
  };
  const [lbl, col] = map[state] || map.idle;
  return (
    <span
      className="syncpill"
      title={lastSync ? 'Dernière synchronisation : ' + fmtClock(lastSync) : 'Aucune synchronisation encore'}
    >
      <span className="syncdot" style={{ background: col }} />
      {lbl}
      {state === 'ok' && lastSync ? <span className="syncts"> · {fmtClock(lastSync)}</span> : null}
    </span>
  );
}

export function Shell({
  user, data, setData, refresh, logout, loading, syncState, lastSync,
}: {
  user: AppUser;
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData | null>>;
  refresh: (silent?: boolean) => Promise<boolean>;
  logout: () => void;
  loading: boolean;
  syncState: SyncState;
  lastSync: number;
}) {
  const [view, setView] = useState('dashboard');
  const [q, setQ] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const toast = useToast();

  // ===== Navigation interne (pile type application) =====
  const navStack = useRef([{ view: 'dashboard', scroll: 0 }]);
  const navPos = useRef(0);
  const overlays = useRef<{ id: number; close: () => void }[]>([]); // pile des fenêtres ouvertes
  const ovSeq = useRef(0);
  const [navUI, setNavUI] = useState({ fwd: false });
  const [confirmExit, setConfirmExit] = useState(false);
  const syncNavUI = () => setNavUI({ fwd: navPos.current < navStack.current.length - 1 });
  const applyEntry = (i: number) => {
    const j = Math.max(0, Math.min(i, navStack.current.length - 1));
    navPos.current = j;
    setView(navStack.current[j].view);
    const y = navStack.current[j].scroll || 0;
    requestAnimationFrame(() => window.scrollTo(0, y));
    syncNavUI();
  };
  const navGo = useCallback((v: string) => {
    if (!v) return;
    // ferme la fenêtre ouverte d'abord (garde anti-perte)
    if (overlays.current.length) { overlays.current[overlays.current.length - 1].close(); return; }
    if (v === navStack.current[navPos.current].view) return; // déjà sur cette page
    navStack.current[navPos.current].scroll = window.scrollY || 0; // mémorise le défilement quitté
    navStack.current = navStack.current.slice(0, navPos.current + 1);
    navStack.current.push({ view: v, scroll: 0 });
    navPos.current = navStack.current.length - 1;
    setView(v);
    try { history.pushState({ cnw: true, i: navPos.current }, ''); } catch { /* ignoré */ }
    window.scrollTo(0, 0);
    syncNavUI();
  }, []);
  const navBack = useCallback(() => {
    if (overlays.current.length) { overlays.current[overlays.current.length - 1].close(); return; }
    if (navPos.current > 0) {
      navStack.current[navPos.current].scroll = window.scrollY || 0;
      try { history.back(); } catch { applyEntry(navPos.current - 1); }
    } else setConfirmExit(true); // déjà à l'accueil → proposer de quitter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const navFwd = useCallback(() => {
    if (overlays.current.length) return;
    if (navPos.current < navStack.current.length - 1) {
      try { history.forward(); } catch { applyEntry(navPos.current + 1); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try { history.replaceState({ cnw: true, i: 0 }, ''); } catch { /* ignoré */ }
    const onPop = (e: PopStateEvent) => {
      if (overlays.current.length) {
        overlays.current[overlays.current.length - 1].close();
        try { history.pushState({ cnw: true, i: navPos.current }, ''); } catch { /* ignoré */ }
        return;
      }
      const st = e.state;
      if (st && st.cnw && typeof st.i === 'number') applyEntry(st.i);
      else {
        try { history.pushState({ cnw: true, i: navPos.current }, ''); } catch { /* ignoré */ }
        setConfirmExit(true);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); navBack(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); navFwd(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [navBack, navFwd]);

  // actions partagées
  const ctx: AppCtxValue = {
    user,
    data,
    toast,
    async save(collection: Collection, record: any, logMsg?: string) {
      let saved: any;
      try {
        saved = await db.enregistrer(collection, record, userLabel(user));
      } catch (e) {
        toast(
          "Échec de l'enregistrement : " + ((e as Error).message || 'erreur réseau') +
            '. Vos données restent affichées — réessayez.',
          'err',
        );
        throw e;
      }
      setData((d) => {
        if (!d) return d;
        const list = (d[collection] as any[]) || [];
        const i = list.findIndex((x) => x.id === saved.id);
        const nl = i >= 0 ? list.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...list];
        return { ...d, [collection]: nl };
      });
      if (logMsg) await ctx.log(logMsg);
      return saved;
    },
    async remove(collection: Collection, id: string, logMsg?: string) {
      // Verrou central des suppressions (protège aussi contre toute manipulation d'interface)
      const delPerm = ({
        devis: 'devisDelete', factures: 'factureDelete', patients: 'patientDelete',
        paiements: 'paymentEdit', options: 'catalogManage',
      } as Record<string, string>)[collection];
      if (delPerm && !can(user, 'all') && !can(user, delPerm)) {
        toast('Action non autorisée : la suppression de cet élément est réservée.', 'err');
        throw new Error('Permission refusée : ' + delPerm);
      }
      try {
        await db.supprimer(collection, id);
      } catch (e) {
        toast('Échec de la suppression : ' + ((e as Error).message || 'erreur réseau') + '. Réessayez.', 'err');
        throw e;
      }
      setData((d) => (d ? { ...d, [collection]: ((d[collection] as any[]) || []).filter((x) => x.id !== id) } : d));
      if (logMsg) await ctx.log(logMsg);
    },
    async nextNumber(type) {
      return db.prochainNumero(type);
    },
    async saveSettings(s: Settings) {
      const saved = await db.enregistrerParametres(s);
      setData((d) => (d ? { ...d, parametres: saved } : d));
    },
    async log(message: string) {
      try {
        const entry = await db.journaliser(userLabel(user), message);
        setData((d) => (d ? { ...d, historique: [entry, ...(d.historique || [])].slice(0, 500) } : d));
      } catch (e) {
        console.warn('[CN][historique] écriture impossible', e);
      }
    },
    go: navGo,
    registerOverlay(close: () => void) {
      const id = ++ovSeq.current;
      overlays.current.push({ id, close });
      return id;
    },
    unregisterOverlay(id: number) {
      overlays.current = overlays.current.filter((o) => o.id !== id);
    },
  };

  const Views: Record<string, () => React.JSX.Element> = {
    dashboard: Dashboard, devis: DevisView, factures: FacturesView, paiements: PaiementsView,
    patients: PatientsView, modeles: ModelesView, options: OptionsView, historique: HistoriqueView,
    parametres: ParametresView, utilisateurs: UtilisateursView,
  };
  const viewAllowed = canView(user, view);
  const Current = viewAllowed
    ? Views[view] || Dashboard
    : () => (
        <Empty
          icon={Ico.cog}
          title="Accès non autorisé"
          sub="Ce module est réservé. Contactez l'administrateur pour obtenir la permission."
        />
      );
  const title = (NAV.find((n) => n.k === view) || {}).label || 'Tableau de bord';
  const navItems = NAV.filter((n) =>
    n.sec ? true : (!n.adminOnly || isAdmin(user)) && canView(user, n.k!),
  );

  return (
    <AppCtx.Provider value={ctx}>
      <OverlayCtx.Provider value={{ registerOverlay: ctx.registerOverlay, unregisterOverlay: ctx.unregisterOverlay }}>
        <div className="app">
          <div className={'scrim ' + (navOpen ? 'show' : '')} onClick={() => setNavOpen(false)} />
          <aside className={'sidebar ' + (navOpen ? 'open' : '')}>
            <div className="brand">
              <div className="mark">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={SIDEBAR_LOGO} alt="Clinic Nobel" />
              </div>
              <div>
                <div className="name">Clinic NobelWorld</div>
                <div className="sub">Devis &amp; Factures</div>
              </div>
            </div>
            {navItems.map((n, i) =>
              n.sec ? (
                <div key={i} className="nav-section">{n.sec}</div>
              ) : (
                <button
                  key={n.k}
                  className={'nav-item ' + (view === n.k ? 'active' : '')}
                  onClick={() => { navGo(n.k!); setNavOpen(false); }}
                >
                  {n.icon ? <n.icon size={18} className="ic" /> : null}
                  {n.label}
                </button>
              ),
            )}
            <div className="nav-spacer" />
            <div className="nav-user">
              {user.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="av" src={user.photo} alt="" style={{ objectFit: 'cover' }} />
              ) : (
                <div className="av">{initials(userLabel(user))}</div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="nm">{userLabel(user)}</div>
                <div className="rl">{ROLES[user.role]?.label || user.fonction || ''}</div>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                style={{ color: '#aebed1' }}
                title="Déconnexion"
                onClick={logout}
              >
                <Ico.arrow size={16} />
              </button>
            </div>
          </aside>
          <div className="main">
            <div className="topbar">
              <button className="menu-btn" onClick={() => setNavOpen(true)}><Ico.menu size={20} /></button>
              <button className="btn btn-ghost btn-sm nav-arrow" title="Retour (Alt+←)" onClick={navBack}>
                <Ico.chevron size={18} style={{ transform: 'rotate(180deg)' }} />
              </button>
              <button
                className="btn btn-ghost btn-sm nav-arrow"
                disabled={!navUI.fwd}
                title="Suivant (Alt+→)"
                onClick={navFwd}
              >
                <Ico.chevron size={18} />
              </button>
              <h1>{title}</h1>
              <div className="search">
                <Ico.search size={16} className="ic" />
                <input
                  placeholder="Rechercher patient, devis, facture…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              {loading && <span className="spin" />}
              <SyncPill state={syncState} lastSync={lastSync} />
              <button
                className="btn btn-ghost btn-sm"
                title="Synchroniser maintenant"
                onClick={async () => {
                  const ok = await refresh();
                  toast(
                    ok
                      ? 'Données synchronisées'
                      : 'Impossible de synchroniser les données. Vérifiez la connexion puis réessayez.',
                    ok ? 'ok' : 'err',
                  );
                }}
              >
                <Ico.hist size={16} />
              </button>
            </div>
            {(syncState === 'error' || syncState === 'offline') && (
              <div className="syncwarn" role="alert">
                ⚠{' '}
                {syncState === 'offline'
                  ? 'Hors ligne — vos données locales restent affichées. La synchronisation reprendra automatiquement au retour du réseau.'
                  : "Échec de synchronisation avec le serveur — vos données locales restent affichées, rien n'a été perdu. Réessayez avec le bouton de synchronisation."}
              </div>
            )}
            <div className="content">
              <ErrorBoundary zone={view} key={view + (q.trim() ? '-s' : '')}>
                {q.trim() ? <SearchResults q={q} onClear={() => setQ('')} /> : <Current />}
              </ErrorBoundary>
            </div>
          </div>
        </div>
        {confirmExit && (
          <Modal
            small
            title="Quitter Clinic NobelWorld ?"
            onClose={() => setConfirmExit(false)}
            footer={
              <>
                <button className="btn" onClick={() => setConfirmExit(false)}>Annuler</button>
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    setConfirmExit(false);
                    try { history.back(); } catch { /* ignoré */ }
                  }}
                >
                  Quitter
                </button>
              </>
            }
          >
            <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
              Vous êtes sur la page d&apos;accueil. Voulez-vous quitter l&apos;application&nbsp;?
            </p>
          </Modal>
        )}
      </OverlayCtx.Provider>
    </AppCtx.Provider>
  );
}
