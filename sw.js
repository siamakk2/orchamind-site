// Orchamind — service worker disabled (kill-switch).
// Removes any previously installed worker and clears its caches so the app
// ALWAYS loads the live version from the network. No stale offline copies.
self.addEventListener('install', function(e){ self.skipWaiting(); });
self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){ return Promise.all(keys.map(function(k){ return caches.delete(k); })); })
      .then(function(){ return self.registration.unregister(); })
      .then(function(){ return self.clients.matchAll(); })
      .then(function(clients){ clients.forEach(function(c){ try{ c.navigate(c.url); }catch(e){} }); })
  );
});
// No fetch caching: let every request hit the network normally.
self.addEventListener('fetch', function(e){});
