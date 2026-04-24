import { serve } from 'std/http/server';
import { createClient } from '@supabase/supabase-js';

// Variables de entorno
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID')!;
const ONESIGNAL_REST_API_KEY = Deno.env.get('ONESIGNAL_REST_API_KEY')!;

// Tipos
interface NotificationRequest {
  user_id: string;
  tipo: 'reserva_cancelada' | 'admin' | 'plaza_asignada' | 'hueco_disponible';
  titulo?: string;
  mensaje?: string;
  data?: Record<string, string>;
}

// Plantillas de mensajes
const TEMPLATES: Record<string, (data: Record<string, string>) => { titulo: string; mensaje: string }> = {
  reserva_cancelada: (data) => ({
    titulo: data.titulo || '❌ Reserva Cancelada',
    mensaje: data.mensaje || `Tu reserva del ${data.fecha || ''} a las ${data.hora || ''} ha sido cancelada.`
  }),

  plaza_asignada: (data) => ({
    titulo: '🎉 ¡Plaza Asignada!',
    mensaje: data.mensaje || `Se te ha asignado plaza en la clase de ${data.modalidad || ''} del ${data.fecha || ''} a las ${data.hora || ''}.`
  }),

  hueco_disponible: (data) => ({
    titulo: '🔔 ¡Hay una plaza disponible!',
    mensaje: data.mensaje || `Hay plaza en la clase de ${data.modalidad || ''} del ${data.fecha || ''} a las ${data.hora || ''}.`
  }),

  admin: (data) => ({
    titulo: data.titulo || '📢 Aviso del Centro',
    mensaje: data.mensaje || 'Tienes un nuevo mensaje del centro.'
  })
};

// Headers CORS
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * Envía una notificación push vía OneSignal REST API.
 * Usa "include_aliases" con external_id para apuntar al usuario correcto.
 * OneSignal asocia el external_id al dispositivo cuando el frontend llama a OneSignal.login(userId).
 */
async function sendOneSignalNotification(
  userId: string,
  titulo: string,
  mensaje: string,
  data: Record<string, string>
): Promise<{ success: boolean; id?: string; error?: string }> {
  let url = data.url;
  if (!url) {
    switch (data.tipo) {
      case 'plaza_asignada':
      case 'hueco_disponible':
        url = '/calendario';
        break;
      case 'reserva_cancelada':
      case 'admin':
        url = '/notificaciones';
        break;
      default:
        url = '/notificaciones';
        break;
    }
  }

  const body: Record<string, any> = {
    app_id: ONESIGNAL_APP_ID,
    // Targeting: enviar al usuario con este external_id
    include_aliases: { external_id: [userId] },
    target_channel: 'push',
    // Contenido
    headings: { en: titulo },
    contents: { en: mensaje },
    // URL a abrir al hacer click
    web_url: `https://centrornace.com${url}`,
    // Datos adicionales (accesibles desde el evento de click)
    data: {
      tipo: data.tipo || 'default',
      url: url,
      ...data
    },
    // Iconos para web
    chrome_web_icon: 'https://centrornace.com/assets/icons/icon-192x192.png',
    chrome_web_badge: 'https://centrornace.com/assets/icons/icon-72x72.png',
    // TTL: 24 horas
    ttl: 86400,
    // Prioridad alta
    priority: 10
  };

  const response = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Key ${ONESIGNAL_REST_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  const result = await response.json();

  if (!response.ok || result.errors) {
    const errorMsg = result.errors
      ? (Array.isArray(result.errors) ? result.errors.join(', ') : JSON.stringify(result.errors))
      : `HTTP ${response.status}`;
    console.error('[OneSignal] Error:', errorMsg);
    return { success: false, error: errorMsg };
  }

  return { success: true, id: result.id };
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
    const payload: NotificationRequest = await req.json();

    // Validar campos
    if (!payload.user_id) throw new Error('user_id es requerido');
    if (!payload.tipo) throw new Error('tipo es requerido');

    // Cliente Supabase con service key
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Validar usuario activo
    const { data: usuario, error: userError } = await supabase
      .from('usuarios')
      .select('activo')
      .eq('id', payload.user_id)
      .single();

    if (userError || !usuario) {
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

    // Generar contenido con plantilla
    const template = TEMPLATES[payload.tipo];
    const content = template
      ? template(payload.data || {})
      : { titulo: payload.titulo || 'RNACE', mensaje: payload.mensaje || '' };

    console.log(`[OneSignal] Enviando "${content.titulo}" a usuario ${payload.user_id}`);

    // Enviar vía OneSignal
    const result = await sendOneSignalNotification(
      payload.user_id,
      content.titulo,
      content.mensaje,
      {
        tipo: payload.tipo,
        ...Object.fromEntries(
          Object.entries(payload.data || {}).map(([k, v]) => [k, String(v)])
        )
      }
    );

    // NOTA: No insertamos en 'notificaciones' aquí porque las funciones SQL
    // (cancelar_reserva_admin, etc.) ya lo hacen. Esto evita duplicados.

    return new Response(
      JSON.stringify({
        success: result.success,
        onesignal_id: result.id,
        error: result.error
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