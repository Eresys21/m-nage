// Service worker : réception des rappels envoyés par Firebase Cloud Messaging.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { data: { body: event.data && event.data.text() } };
  }
  const data = payload.data || {};
  const notif = payload.notification || {};
  event.waitUntil(
    self.registration.showNotification(data.title || notif.title || 'M-nage', {
      body: data.body || notif.body || '',
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: data.tag,
      renotify: Boolean(data.tag),
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const client = clients.find((c) => 'focus' in c);
      return client ? client.focus() : self.clients.openWindow('./');
    })
  );
});
