'use client';

import { createContext, useContext } from 'react';
import type { AppData, Collection } from '@/lib/types';
import type { AppUser } from '@/lib/perms';
import type { Settings } from '@/lib/defaults';

/* Le dossier à OUVRIR en arrivant sur une vue — par son IDENTIFIANT, jamais
   par sa position dans une liste (la liste de la vue n'est ni celle des
   résultats de recherche, ni dans le même ordre). Posé par `go(vue, cible)`,
   consommé une fois par la vue qui l'ouvre, puis effacé (`cibleAtteinte`). */
export interface Cible {
  type: 'patient' | 'devis' | 'facture';
  id: string;
}

export interface AppCtxValue {
  user: AppUser;
  data: AppData;
  toast: (msg: string, type?: 'ok' | 'err') => void;
  save: (collection: Collection, record: any, logMsg?: string) => Promise<any>;
  remove: (collection: Collection, id: string, logMsg?: string) => Promise<void>;
  nextNumber: (type: 'devis' | 'facture') => Promise<string>;
  saveSettings: (s: Settings) => Promise<void>;
  log: (message: string) => Promise<void>;
  /** Navigue vers une vue ; avec `cible`, y ouvre ce dossier et efface la recherche en cours. */
  go: (view: string, cible?: Cible) => void;
  cible: Cible | null;
  cibleAtteinte: () => void;
  registerOverlay: (close: () => void) => number;
  unregisterOverlay: (id: number) => void;
}

export const AppCtx = createContext<AppCtxValue | null>(null);

export const useApp = () => {
  const v = useContext(AppCtx);
  if (!v) throw new Error("useApp() utilisé hors du contexte de l'application.");
  return v;
};

/** Variante tolérante : le document PDF peut être rendu hors contexte (aperçu isolé). */
export const useAppMaybe = () => useContext(AppCtx);
