'use client';

import { useEffect } from 'react';

/* PWA : enregistrement tolérant du service worker — silencieux si sw.js est absent.
   registration.update() force la vérification d'une nouvelle version. */
export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((reg) => { try { reg.update(); } catch { /* ignoré */ } })
      .catch(() => { /* pas de sw.js : mode web classique, aucun impact */ });
  }, []);
  return null;
}
