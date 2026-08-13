// Mismo contenido y mismo motivo que OneSignalSDKWorker.js: ver el comentario
// de ese fichero. OneSignal exige que los dos existan y sean equivalentes.
try {
  importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
} catch (error) {
  console.warn("[Push][SW] CDN de OneSignal no accesible, usando proxy propio", error);
  importScripts("/onesignal-sdk/OneSignalSDK.sw.js");
}
