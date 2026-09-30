// Proxy de primera parte para el SDK de OneSignal: /onesignal-sdk/<fichero>
// sirve https://cdn.onesignal.com/sdks/web/v16/<fichero> a traves de
// centrornace.com. Es el plan B de index.html y de OneSignalSDKWorker.js cuando
// el dispositivo tiene bloqueado cdn.onesignal.com (bloqueador de anuncios, DNS
// privado, VPN con filtrado, antivirus, red corporativa).
//
// Tiene que ser una Edge Function y no una regla de public/_redirects: el SSR de
// Angular (@netlify/angular-runtime) es tambien una Edge Function en "/*" y
// responde antes de que se apliquen las redirecciones, asi que la reescritura
// nunca llegaba a ejecutarse y /onesignal-sdk/* devolvia un 302 a /dashboard.
// Las Edge Functions declaradas en netlify.toml se ejecutan antes que la de
// Angular (igual que canonical-domain).

const CDN_BASE = 'https://cdn.onesignal.com/sdks/web/v16/';

// Solo ficheros .js sueltos de la carpeta del SDK (sin "/"), para que esto no
// se pueda usar como proxy abierto hacia otras rutas del CDN.
const FICHERO_SDK = /^[A-Za-z0-9._-]+\.js$/;

export default async (request: Request) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(request.url);
  const fichero = url.pathname.replace(/^\/onesignal-sdk\//, '');

  if (!FICHERO_SDK.test(fichero)) {
    return new Response('Not found', { status: 404 });
  }

  try {
    // Se conserva la query (?v=...): el cargador de OneSignal versiona el bundle asi.
    const upstream = await fetch(CDN_BASE + fichero + url.search, { method: request.method });

    if (!upstream.ok) {
      // Un 4xx del CDN se propaga tal cual; un 5xx es un fallo de pasarela.
      return new Response(`El CDN de OneSignal respondio ${upstream.status}`, {
        status: upstream.status >= 500 ? 502 : upstream.status,
      });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        // importScripts del service worker exige un MIME de JavaScript.
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': upstream.headers.get('Cache-Control') ?? 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('[onesignal-proxy] No se pudo pedir al CDN de OneSignal:', error);
    return new Response('CDN de OneSignal no accesible', { status: 502 });
  }
};
