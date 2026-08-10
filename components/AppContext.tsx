'use client';

import { createContext, useContext } from 'react';
import type { AppData, Collection } from '@/lib/types';
import type { AppUser } from '@/lib/perms';
import type { Settings } from '@/lib/defaults';

export interface AppCtxValue {
  user: AppUser;
  data: AppData;
  toast: (msg: string, type?: 'ok' | 'err') => void;
  save: (collection: Collection, record: any, logMsg?: string) => Promise<any>;
  remove: (collection: Collection, id: string, logMsg?: string) => Promise<void>;
  nextNumber: (type: 'devis' | 'facture') => Promise<string>;
  saveSettings: (s: Settings) => Promise<void>;
  log: (message: string) => Promise<void>;
  go: (view: string) => void;
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
