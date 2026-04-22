// ====================================================================
// Firebase Messaging Service Worker — RNACE
// ====================================================================
// Estrategia: Dejamos que Firebase registre SU listener de push,
// pero NO usamos onBackgroundMessage (que intenta renderizar una
// notificación nativa que puede fallar en iOS/Android PWA).
// En su lugar, interceptamos el push ANTES que Firebase con nuestro
// propio listener y mostramos la notificación manualmente.
//
// IMPORTANTE: No usar stopImmediatePropagation() — eso impide que
// Firebase confirme la recepción del push al OS, causando que en
// background/cerrado las notificaciones no lleguen.
// ====================================================================

// 1. Importar Firebase PRIMERO para que su SDK se registre correctamente
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCzBNKc2TwhtqlgCCljwQMQPkPX6ujha1k',
  authDomain: 'rnace-50c31.firebaseapp.com',
  projectId: 'rnace-50c31',
  storageBucket: 'rnace-50c31.appspot.com',
  messagingSenderId: '626137220500',
  appId: '1:626137220500:web:33bfa04ed535711ec0bb81'
});

const messaging = firebase.messaging();

// 2. Usar onBackgroundMessage de Firebase para manejar pushes en background.
//    Esto es la forma OFICIAL y compatible. Firebase se encarga de despertar el SW
//    y confirmar la recepción con el OS (crítico para iOS Safari y Android).
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] onBackgroundMessage:', payload);

  // Nuestro payload viene como data-only desde la edge function
  const data = payload.data || {};
  const title = data.title || payload.notification?.title || 'Notificación RNACE';
  const body = data.body || payload.notification?.body || 'Tienes un nuevo aviso';

  const options = {
    body: body,
    icon: '/assets/icons/icon-192x192.png',
    badge: '/assets/icons/icon-72x72.png',
    vibrate: [100, 50, 100],
    data: data,
    requireInteraction: false,
    tag: data.tag || undefined,
    renotify: !!data.tag
  };

  // Mostrar la notificación nativa
  return self.registration.showNotification(title, options);
});

// ====================================================================
// NOTIFICATION CLICK HANDLER
// ====================================================================
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const action = event.action;
  const data = event.notification.data || {};
  let url = '/';

  switch (action) {
    case 'ver':
    case 'confirmar':
      url = data.url || '/';
      break;
    case 'calendario':
      url = '/calendario';
      break;
    case 'nueva':
      url = '/reserva-cita';
      break;
    case 'rechazar':
      return;
    default:
      url = data.url || '/';
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus().then(c => c.navigate && c.navigate(url));
          }
        }
        return clients.openWindow(url);
      })
  );
});