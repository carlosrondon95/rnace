// El service worker de OneSignal es solo este import: el codigo real vive en su
// CDN. Si ese dominio esta bloqueado en el dispositivo (bloqueador de anuncios,
// DNS privado, VPN con filtrado, antivirus, red corporativa), importScripts
// lanza, la instalacion del service worker falla y el navegador no puede crear
// ninguna suscripcion push, aunque el permiso este concedido.
//
// /onesignal-sdk/ es un proxy de primera parte definido en public/_redirects:
// sirve el mismo fichero a traves de centrornace.com, que no aparece en las
// listas de bloqueo por dominio.
try {
  importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
} catch (error) {
  console.warn("[Push][SW] CDN de OneSignal no accesible, usando proxy propio", error);
  importScripts("/onesignal-sdk/OneSignalSDK.sw.js");
}
