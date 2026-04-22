// ====================================================================
// Firebase Messaging Service Worker — RNACE
// ====================================================================

// 1. INTERCEPTAR EL PUSH NATIVAMENTE ANTES QUE FIREBASE
// iOS Safari mata los Service Workers muy rápido si están en background.
// Inicializar Firebase toma tiempo. Por eso interceptamos el evento push 
// nativamente de forma ultrarrápida y evitamos el timeout de iOS.
self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.json() : {};
  const data = payload.data || {};

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Comprobar si la PWA está abierta en pantalla
      const isForeground = windowClients.some(client => client.visibilityState === 'visible');

      if (isForeground) {
        // La app está abierta. No mostramos notificación nativa.
        // Firebase enviará los datos a la app y saldrá un toast.
        return null;
      }

      // La app está cerrada o en segundo plano. Mostramos notificación nativa instantáneamente.
      const title = data.title || 'RNACE';
      const options = {
        body: data.body || '',
        icon: '/assets/icons/icon-192x192.png',
        badge: '/assets/icons/icon-72x72.png',
        data: data,
        tag: data.tag || undefined,
        renotify: !!data.tag
      };

      return self.registration.showNotification(title, options);
    }).catch(err => {
      console.error('[SW] Error en push nativo:', err);
      // Fallback a prueba de fallos si falla el chequeo de ventanas
      return self.registration.showNotification(data.title || 'RNACE', { body: data.body || '' });
    })
  );
});

// 2. CLICK HANDLER NATIVO
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

// 3. CARGAR FIREBASE EN BACKGROUND (SOLO PARA FOREGROUND)
// Necesitamos que el SDK esté presente para que el frontend pueda registrarse
// y recibir mensajes en foreground a través de la API de Firebase.
// PERO ya no usamos onBackgroundMessage.
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

// Esto inicializa el listener interno de Firebase para sincronizarse con la app web
firebase.messaging();