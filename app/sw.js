// Service worker: makes the app installable and usable on a bad connection.
// - audio files never change (their name is a hash of voice and text): cache first
// - everything else: network first, so a new version or new content shows up
//   the next time she opens the app online; the cache is the offline fallback
const CACHE = 'tegeltjes-v1';
const SHELL = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
  'fonts/atkinson-hyperlegible-next-latin-wght-normal.woff2',
  'js/main.js', 'js/content.js', 'js/exercises.js', 'js/checker.js', 'js/store.js', 'js/audio.js', 'js/md.js', 'js/glyphs.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tegeltjes-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isAudioFile(url) { return /\/audio\/[0-9a-f]+\.(mp3|ogg)$/.test(url.pathname); }

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isAudioFile(url)) {
    event.respondWith(caches.open(CACHE).then((cache) => cache.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }))));
    return;
  }
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
