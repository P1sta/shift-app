// Service Worker for Shift Registration App
// Enables offline support, caching, and PWA features

const CACHE_NAME = 'shift-app-v2.0';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/manifest.json'
];

// Install event - cache essential assets
self.addEventListener('install', (event) => {
    console.log('Service Worker installing...');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('Caching assets');
            return cache.addAll(ASSETS_TO_CACHE).catch(err => {
                console.log('Cache addAll failed:', err);
                // Don't fail install if caching fails
            });
        })
    );
    self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('Service Worker activating...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
    // Skip API calls and non-GET requests
    if (event.request.method !== 'GET' || event.request.url.includes('/api/')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((response) => {
            if (response) {
                return response;
            }

            return fetch(event.request).then((response) => {
                // Don't cache non-successful responses
                if (!response || response.status !== 200 || response.type !== 'basic') {
                    return response;
                }

                // Clone the response
                const responseToCache = response.clone();

                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseToCache);
                });

                return response;
            }).catch(() => {
                // Return offline page or cached response
                return caches.match('/index.html');
            });
        })
    );
});

// Message handler for cache updates
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    
    if (event.data && event.data.type === 'CLEAR_CACHE') {
        caches.delete(CACHE_NAME);
    }
});

// Background sync for offline registrations
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-shifts') {
        event.waitUntil(
            // Try to sync data when back online
            fetch('/api/data').catch(err => {
                console.log('Sync failed, data will sync when online');
            })
        );
    }
});

// Handle push notifications (if implemented)
self.addEventListener('push', (event) => {
    const data = event.data ? event.data.json() : {
        title: 'Shift Notification',
        body: 'You have a new notification'
    };

    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect fill="%23c41e3a" width="192" height="192"/><text x="96" y="140" font-size="120" text-anchor="middle" fill="white">📅</text></svg>',
            badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect fill="%23c41e3a" width="192" height="192"/><text x="96" y="140" font-size="120" text-anchor="middle" fill="white">📅</text></svg>'
        })
    );
});

console.log('Service Worker loaded');
