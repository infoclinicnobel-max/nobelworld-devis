// Service worker Clinic Nobel — v2
// AUCUN cache volontairement : l'application charge toujours la dernière version déployée.
// À l'activation : purge de TOUT cache résiduel (aucune version fantôme possible),
// même laissé par un ancien service worker.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (e) {}
    await self.clients.claim();
  })());
});
