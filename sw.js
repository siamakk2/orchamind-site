// Orchamind Site Manager - offline app shell
var CACHE='orcha-shell-v3';
var SHELL=['/app','/demo.html'];
self.addEventListener('install',function(e){
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function(c){
    return Promise.all(SHELL.map(function(u){
      return fetch(u,{cache:'reload'}).then(function(r){if(r&&r.ok)return c.put(u,r.clone());}).catch(function(){});
    }));
  }));
});
self.addEventListener('activate',function(e){
  e.waitUntil(
    caches.keys().then(function(keys){return Promise.all(keys.map(function(k){if(k!==CACHE)return caches.delete(k);}));})
    .then(function(){return self.clients.claim();})
  );
});
self.addEventListener('fetch',function(e){
  var req=e.request;
  if(req.method!=='GET')return;
  var url;
  try{url=new URL(req.url);}catch(err){return;}
  if(url.origin!==location.origin)return;            // leave cross-origin (fonts, analytics, AI) alone
  if(url.pathname.indexOf('/api/')===0)return;       // never cache the API; offline -> app falls back to localStorage
  if(req.mode==='navigate'){
    // network-first so updates appear online; cached shell when offline
    e.respondWith(
      fetch(req).then(function(r){
        var cp=r.clone();caches.open(CACHE).then(function(c){c.put(req,cp).catch(function(){});});
        return r;
      }).catch(function(){
        return caches.match(req).then(function(m){return m||caches.match('/app')||caches.match('/demo.html');});
      })
    );
    return;
  }
  // other same-origin assets: stale-while-revalidate
  e.respondWith(
    caches.match(req).then(function(m){
      var fp=fetch(req).then(function(r){
        if(r&&r.ok){var cp=r.clone();caches.open(CACHE).then(function(c){c.put(req,cp).catch(function(){});});}
        return r;
      }).catch(function(){return m;});
      return m||fp;
    })
  );
});
