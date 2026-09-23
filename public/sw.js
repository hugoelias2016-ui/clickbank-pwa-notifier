self.addEventListener('push', (event) => {
  let data = { title: 'Nova Venda!', body: 'Você realizou uma venda na ClickBank.' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }
  const options = {
    body: data.body,
    icon: 'https://cdn-icons-png.flaticon.com/512/3135/3135706.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/3135/3135706.png',
    vibrate: [300, 100, 300, 100, 600],
    tag: 'cb-sale-' + Date.now(),
    renotify: true,
    requireInteraction: true,
    data: { url: '/' }
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
