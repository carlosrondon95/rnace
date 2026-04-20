import { serve } from 'std/http/server';
import { createClient } from '@supabase/supabase-js';
import { SignJWT, importPKCS8 } from 'jose';

// Variables de entorno
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Configuración de Service Account (puede venir como variables individuales o un JSON completo)
const FIREBASE_SERVICE_ACCOUNT = Deno.env.get('FIREBASE_SERVICE_ACCOUNT');
const FIREBASE_PROJECT_ID = Deno.env.get('FIREBASE_PROJECT_ID');
const FIREBASE_CLIENT_EMAIL = Deno.env.get('FIREBASE_CLIENT_EMAIL');
const FIREBASE_PRIVATE_KEY = Deno.env.get('FIREBASE_PRIVATE_KEY');

// Tipos
interface NotificationRequest {
  user_id: string;
  tipo: 'reserva_confirmada' | 'reserva_cancelada' | 'recordatorio' | 'lista_espera' | 'admin';
  titulo?: string;
  mensaje?: string;
  data?: Record<string, string>;
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

// Cache de access token (reutilizable entre invocaciones en el mismo worker)
let cachedAccessToken: string | null = null;
let cachedTokenExpiry = 0;

// Plantillas de mensajes
const TEMPLATES: Record<string, (data: Record<string, string>) => { titulo: string; mensaje: string }> = {
  reserva_confirmada: (data) => ({
    titulo: '✅ Reserva Confirmada',
    mensaje: `Tu reserva para el ${data.fecha || ''} a las ${data.hora || ''} ha sido confirmada.`
  }),

  reserva_cancelada: (data) => ({
    titulo: '❌ Reserva Cancelada',
    mensaje: `Tu reserva del ${data.fecha || ''} a las ${data.hora || ''} ha sido cancelada.`
  }),



  recordatorio: (data) => ({
    titulo: '⏰ Recordatorio',
    mensaje: `Tu sesión comienza en ${data.minutos || '30'} minutos. ¡No llegues tarde!`
  }),

  lista_espera: (data) => ({
    titulo: '🎉 ¡Plaza Disponible!',
    mensaje: `Se ha liberado una plaza para el ${data.fecha || ''} a las ${data.hora || ''}. ¡Confírmala!`
  }),

  plaza_asignada: (data) => ({
    titulo: '🎉 ¡Plaza Asignada!',
    mensaje: data.mensaje || 'Se te ha asignado una plaza. ¡Revisa tu calendario!'
  }),

  hueco_disponible: (data) => ({
    titulo: '🔔 ¡Hay una plaza disponible!',
    mensaje: data.mensaje || 'Hay una plaza disponible en una clase. ¡Date prisa!'
  }),

  admin: (data) => ({
    titulo: data.titulo || '📢 Aviso del Centro',
    mensaje: data.mensaje || 'Tienes un nuevo mensaje del centro.'
  })
};

// Acciones para webpush
function _getActionsForType(tipo: string): Array<{ action: string; title: string }> {
  switch (tipo) {
    case 'reserva_confirmada':
      return [
        { action: 'ver', title: '📅 Ver reserva' },
        { action: 'calendario', title: '🗓️ Calendario' }
      ];
    case 'reserva_cancelada':
      return [
        { action: 'nueva', title: '➕ Nueva reserva' }
      ];
    case 'recordatorio':
      return [
        { action: 'ver', title: '👀 Ver detalles' }
      ];
    case 'lista_espera':
      return [
        { action: 'confirmar', title: '✅ Confirmar' },
        { action: 'rechazar', title: '❌ Rechazar' }
      ];
    default:
      return [];
  }
}


// Headers CORS
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function getAccessToken(serviceAccount: ServiceAccount): Promise<string> {
  // Reutilizar token cacheado si aún es válido (margen de 10 min)
  const now = Date.now();
  if (cachedAccessToken && now < cachedTokenExpiry) {
    return cachedAccessToken;
  }

  const jwt = await new SignJWT({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token'
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setExpirationTime('1h')
    .sign(await importPKCS8(serviceAccount.private_key, 'RS256'));

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  const data = await response.json();

  // Cachear por 50 minutos (el token dura 1h)
  cachedAccessToken = data.access_token;
  cachedTokenExpiry = now + 50 * 60 * 1000;

  return data.access_token;
}

function getServiceAccount(): ServiceAccount {
  if (FIREBASE_SERVICE_ACCOUNT) {
    try {
      return JSON.parse(FIREBASE_SERVICE_ACCOUNT);
    } catch {
      console.error('Error parseando FIREBASE_SERVICE_ACCOUNT');
    }
  }

  if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
    return {
      project_id: FIREBASE_PROJECT_ID,
      client_email: FIREBASE_CLIENT_EMAIL,
      private_key: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') // Corregir saltos de línea si vienen escapados
    };
  }

  throw new Error('Configuración de Firebase Service Account no encontrada');
}

serve(async (req: Request) => {
  // Manejar preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, error: 'Método no permitido' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const serviceAccount = getServiceAccount();
    const payload: NotificationRequest = await req.json();

    // Validar campos
    if (!payload.user_id) throw new Error('user_id es requerido');
    if (!payload.tipo) throw new Error('tipo es requerido');

    // Cliente Supabase con service key
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Obtener tokens FCM del usuario
    const { data: tokens, error: tokensError } = await supabase
      .from('fcm_tokens')
      .select('token, device_info')
      .eq('user_id', payload.user_id);

    if (tokensError) throw tokensError;

    // Validar usuario activo
    const { data: usuario, error: userError } = await supabase
      .from('usuarios')
      .select('activo')
      .eq('id', payload.user_id)
      .single();

    if (userError || !usuario) {
      // Si no encontramos al usuario, asumimos que no es válido
      return new Response(
        JSON.stringify({ success: false, message: 'Usuario no encontrado' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!usuario.activo) {
      console.log(`Usuario ${payload.user_id} inactivo. Omitiendo notificación.`);
      return new Response(
        JSON.stringify({ success: true, message: 'Usuario inactivo. Notificación omitida.', skipped: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!tokens || tokens.length === 0) {
      return new Response(
        JSON.stringify({ success: false, message: 'El usuario no tiene dispositivos registrados' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Enviando a ${tokens.length} dispositivo(s)`);

    // Obtener token de acceso para FCM v1
    const accessToken = await getAccessToken(serviceAccount);

    // Generar contenido con plantilla
    const template = TEMPLATES[payload.tipo];
    const content = template
      ? template(payload.data || {})
      : { titulo: payload.titulo || 'RNACE', mensaje: payload.mensaje || '' };

    const url = payload.data?.url || '/';

    // Enviar a todos los dispositivos
    const results = await Promise.all(
      tokens.map(async ({ token, device_info }) => {
        try {
          // Tag único: se usa TANTO en data (para el SW) como en webpush.notification (fallback).
          // Deben ser idénticos para que si ambos se muestran, uno reemplace al otro.
          const notifTag = `${payload.tipo}-${Date.now()}`;

          const response = await fetch(
            `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
              },
              body: JSON.stringify({
                message: {
                  token: token,
                  // Al no enviar 'notification' a nivel raíz, forzamos un Data-Only payload.
                  // Esto evita que la librería nativa de FCM intente pintar
                  // la notificación por defecto y entre en conflicto con el
                  // manual showNotification() de nuestro Service Worker.

                  // Data: el SW lee estos campos para construir la notificación 
                  // o acciones personalizadas.
                  data: {
                    title: content.titulo,
                    body: content.mensaje,
                    click_action: url,
                    tipo: payload.tipo,
                    url: url,
                    tag: notifTag,
                    ...Object.fromEntries(
                      Object.entries(payload.data || {}).map(([k, v]) => [k, String(v)])
                    )
                  },
                  // NOTA: Los tokens FCM de una PWA son tokens WEB.
                  // Los bloques `android` y `apns` solo aplican a apps NATIVAS
                  // con FCM SDK instalado, NO a PWAs en Chrome/Safari.
                  // Para PWAs, solo el bloque `webpush` tiene efecto.

                  // Configuración WEB (PWA): afecta Android Chrome + iOS Safari + Desktop
                  webpush: {
                    headers: {
                      Urgency: 'high',
                      TTL: '86400'
                    },
                    // Fallback: si el SW no llega a ejecutar showNotification a tiempo
                    // (puede pasar en iOS Safari con PWA cerrada), el navegador usa esto.
                    // Usamos el mismo tag que en data, así si AMBOS se muestran,
                    // el segundo reemplaza al primero (no hay duplicado).
                    notification: {
                      title: content.titulo,
                      body: content.mensaje,
                      icon: '/assets/icons/icon-192x192.png',
                      badge: '/assets/icons/icon-72x72.png',
                      tag: notifTag
                    }
                  }
                }
              })
            }
          );

          const result = await response.json();

          if (!response.ok) {
            const errorCode = result.error?.details?.[0]?.errorCode || result.error?.status;

            // Si token inválido, eliminarlo
            if (errorCode === 'UNREGISTERED' || errorCode === 'INVALID_ARGUMENT') {
              console.log(`Token inválido (${errorCode}), eliminando...`);
              await supabase.from('fcm_tokens').delete().eq('token', token);
            }

            throw new Error(result.error?.message || 'Error desconocido de FCM');
          }

          return {
            device: device_info || 'unknown',
            success: true,
            messageId: result.name
          };
        } catch (error) {
          return {
            device: device_info || 'unknown',
            success: false,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      })
    );

    // NOTA: No insertamos en 'notificaciones' aquí porque las funciones SQL
    // (cancelar_reserva_admin, etc.) ya lo hacen. Esto evita duplicados.

    const successCount = results.filter(r => r.success).length;

    return new Response(
      JSON.stringify({
        success: true,
        sent_to: tokens.length,
        successful: successCount,
        results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});