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

  cancelacion: (data) => ({
    titulo: data.titulo || '📅 Clase Cancelada',
    mensaje: data.mensaje || 'Una de tus clases ha sido cancelada.'
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
function getActionsForType(tipo: string): Array<{ action: string; title: string }> {
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
                  // BLOQUE NOTIFICACIÓN: Crítico para iOS y Android background
                  notification: {
                    title: content.titulo,
                    body: content.mensaje,
                  },
                  // Data para manejo en foreground o info extra
                  data: {
                    title: content.titulo,
                    body: content.mensaje,
                    icon: '/assets/icon/logofull.JPG',
                    click_action: url,
                    tipo: payload.tipo,
                    url: url,
                    tag: `${payload.tipo}-${Date.now()}`,
                    ...payload.data
                  },
                  // Configuración específica ANDROID
                  android: {
                    priority: 'high',
                    notification: {
                      channel_id: 'default',
                      icon: 'stock_ticker_update', // Icono nativo si existe, o default
                      click_action: url
                    }
                  },
                  // Configuración específica APPLE (iOS/macOS)
                  apns: {
                    payload: {
                      aps: {
                        alert: {
                          title: content.titulo,
                          body: content.mensaje
                        },
                        sound: 'default',
                        badge: 1,
                        'content-available': 1 // Para despertar la app en background
                      }
                    },
                    headers: {
                      'apns-priority': '10', // 10 = High (entrega inmediata), 5 = Low
                      'apns-push-type': 'alert'
                    }
                  },
                  // Configuración específica WEB (PWA)
                  webpush: {
                    headers: {
                      Urgency: 'high'
                    },
                    notification: {
                      title: content.titulo,
                      body: content.mensaje,
                      icon: '/assets/icon/logofull.JPG',
                      badge: '/assets/icon/logofull.JPG',
                      vibrate: [200, 100, 200],
                      data: { url: url }, // URL para el click listener del SW
                      tag: `${payload.tipo}-${Date.now()}`,
                      renotify: true,
                      requireInteraction: ['reserva_cancelada', 'lista_espera', 'admin_urgent'].includes(payload.tipo),
                      actions: getActionsForType(payload.tipo)
                    },
                    fcm_options: {
                      link: url
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