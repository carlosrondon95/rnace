// Interceptamos manualmente el push ANTES de Firebase
// Esto arregla crashes de FCM SDK en iOS PWA y algunos Android
self.addEventListener('push', function(event) {
  // Evitamos que Firebase procese este push y cause dobles notificaciones o crashes
  // Firebase usa la notificación directa, nosotros tomamos el control total aquí.
  event.stopImmediatePropagation();

  let title = 'Notificación RNACE';
  let body = 'Tienes un nuevo aviso';
  let dataObj = {};

  try {
    if (event.data) {
      const payload = event.data.json();
      console.log('[SW] Custom Push:', payload);
      
      // Intentar extraer titulo de "data" (como viene de nuestra edge func) o de "notification"
      title = payload.notification?.title || payload.data?.title || title;
      body = payload.notification?.body || payload.data?.body || body;
      dataObj = payload.data || {};
    }
  } catch (err) {
    console.error('[SW] Parse push error:', err);
  }

  const options = {
    body: body,
    icon: '/assets/icon/logofull.JPG', // Ruta del icono de la PWA
    data: dataObj,
    requireInteraction: false
  };

  event.waitUntil(
    self.registration.showNotification(title, options).catch(err => {
      console.error('[SW] showNotification Error:', err);
    })
  );
});

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

// NOTA: No usamos messaging.onBackgroundMessage debido a bugs de renderizado 
// nativo de iOS Safari/Chrome Android. Todo se maneja en el listener "push" de la línea 1.

// ====================================================================
// NOTIFICATION CLICK HANDLER
// ====================================================================
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const action = event.action;
  const data = event.notification.data || {};

  // Extraer información de data
  const fcmData = data || {};
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
             // Intenta enfocarse en la PWA si ya está abierta
            return client.focus().then(c => c.navigate && c.navigate(url));
          }
        }
        // Si no está abierta, abre una nueva ventana/instancia de la PWA
        return clients.openWindow(url);
      })
  );
});