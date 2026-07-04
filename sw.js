// Service worker minimal Clinic Nobel — AUCUN cache volontairement :
// l'application charge toujours la dernière version déployée (pas de version fantôme).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
