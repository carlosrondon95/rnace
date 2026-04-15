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

// Track notifications already shown by onBackgroundMessage to avoid duplicates
const _notificationsShown = new Set();

// ====================================================================
// BACKGROUND NOTIFICATIONS
// ====================================================================
// onBackgroundMessage handles data-only messages from FCM.
// For messages with a 'notification' block, FCM *may* auto-display,
// but on many PWA environments (iOS, some Android browsers) it does NOT.
// We explicitly call showNotification to guarantee display.
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] onBackgroundMessage recibido:', payload);

  const data = payload.data || {};
  const tipo = data.tipo || 'default';
  const config = NOTIFICATION_CONFIG[tipo] || NOTIFICATION_CONFIG.default;

  const title = data.title || payload.notification?.title || 'RNACE';
  const body = data.body || payload.notification?.body || '';
  const tag = data.tag || `${tipo}-${Date.now()}`;

  // Mark as shown so the fallback push listener skips it
  _notificationsShown.add(tag);
  setTimeout(() => _notificationsShown.delete(tag), 5000);

  const options = {
    body: body,
    icon: config.icon,
    badge: config.badge,
    vibrate: config.vibrate,
    tag: tag,
    renotify: true,
    data: { url: data.url || data.click_action || '/', tipo: tipo, ...data },
    actions: config.actions || [],
    requireInteraction: config.requireInteraction || false
  };

  return self.registration.showNotification(title, options);
});

// ====================================================================
// FALLBACK: Native 'push' event listener
// ====================================================================
// In some environments, firebase-messaging-compat does NOT intercept
// the push event properly (especially iOS PWA, or when the SW is
// woken from a terminated state). This native listener acts as a
// safety net.
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch (e) {
    console.warn('[SW] Push data is not JSON:', e);
    return;
  }

  const fcmData = payload.data || {};
  const tipo = fcmData.tipo || 'default';
  const tag = fcmData.tag || `${tipo}-${Date.now()}`;

  // If onBackgroundMessage already showed this notification, skip
  if (_notificationsShown.has(tag)) {
    console.log('[SW] Push fallback: notification already shown by onBackgroundMessage, skipping');
    return;
  }

  const config = NOTIFICATION_CONFIG[tipo] || NOTIFICATION_CONFIG.default;
  const title = fcmData.title || payload.notification?.title || 'RNACE';
  const body = fcmData.body || payload.notification?.body || '';

  const options = {
    body: body,
    icon: config.icon,
    badge: config.badge,
    vibrate: config.vibrate,
    tag: tag,
    renotify: true,
    data: { url: fcmData.url || fcmData.click_action || '/', tipo: tipo, ...fcmData },
    actions: config.actions || [],
    requireInteraction: config.requireInteraction || false
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ====================================================================
// NOTIFICATION CLICK HANDLER
// ====================================================================
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const action = event.action;
  const data = event.notification.data || {};

  // Extract URL from notification data
  // Firebase sometimes wraps data inside FCM_MSG
  const fcmData = data?.FCM_MSG?.data || data || {};
  let url = '/';
  
  switch (action) {
    case 'ver':
    case 'confirmar':
      url = fcmData.url || '/';
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
      url = fcmData.url || '/';
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