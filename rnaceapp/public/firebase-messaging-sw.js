importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

// Configuración de Firebase para notificaciones push
firebase.initializeApp({
  apiKey: 'AIzaSyCzBNKc2TwhtqlgCCljwQMQPkPX6ujha1k',
  authDomain: 'rnace-50c31.firebaseapp.com',
  projectId: 'rnace-50c31',
  storageBucket: 'rnace-50c31.appspot.com',
  messagingSenderId: '626137220500',
  appId: '1:626137220500:web:33bfa04ed535711ec0bb81'
});

const messaging = firebase.messaging();

// Configuración por tipo de notificación
const NOTIFICATION_CONFIG = {
  reserva_confirmada: {
    icon: '/assets/icon/logofull.JPG',
    badge: '/assets/icon/logofull.JPG',
    vibrate: [200, 100, 200],
    actions: [
      { action: 'ver', title: '📅 Ver reserva' },
      { action: 'calendario', title: '🗓️ Calendario' }
    ]
  },
  reserva_cancelada: {
    icon: '/assets/icon/logofull.JPG',
    badge: '/assets/icon/logofull.JPG',
    vibrate: [300, 100, 300, 100, 300],
    requireInteraction: true,
    actions: [
      { action: 'nueva', title: '➕ Nueva reserva' }
    ]
  },
  recordatorio: {
    icon: '/assets/icon/logofull.JPG',
    badge: '/assets/icon/logofull.JPG',
    vibrate: [100, 50, 100],
    actions: [
      { action: 'ver', title: '👀 Ver detalles' }
    ]
  },
  lista_espera: {
    icon: '/assets/icon/logofull.JPG',
    badge: '/assets/icon/logofull.JPG',
    vibrate: [200, 100, 200, 100, 200],
    requireInteraction: true,
    actions: [
      { action: 'confirmar', title: '✅ Confirmar' },
      { action: 'rechazar', title: '❌ Rechazar' }
    ]
  },
  default: {
    icon: '/assets/icon/logofull.JPG',
    badge: '/assets/icon/logofull.JPG',
    vibrate: [100]
  }
};

// Notificaciones en background
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Notificación recibida:', payload);

  const notificationTitle = payload.notification?.title || payload.data?.titulo || 'RNACE';
  const notificationOptions = {
    body: payload.notification?.body || payload.data?.mensaje || '',
    icon: '/assets/icon/logofull.JPG', // Asegurar que esta ruta existe
    data: payload.data
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Click en notificación
self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const action = event.action;
  const data = notification.data || {};

  notification.close();

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