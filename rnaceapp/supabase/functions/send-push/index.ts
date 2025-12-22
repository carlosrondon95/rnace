import { serve } from 'std/http/server';
import { createClient } from '@supabase/supabase-js';

// Variables de entorno
const FIREBASE_SERVER_KEY = Deno.env.get('FIREBASE_SERVER_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Tipos
interface NotificationRequest {
  user_id: string;
  tipo: 'reserva_confirmada' | 'reserva_cancelada' | 'recordatorio' | 'lista_espera' | 'admin';
  titulo?: string;
  mensaje?: string;
  data?: Record<string, string>;
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

  recordatorio: (data) => ({
    titulo: '⏰ Recordatorio',
    mensaje: `Tu sesión comienza en ${data.minutos || '30'} minutos. ¡No llegues tarde!`
  }),

  lista_espera: (data) => ({
    titulo: '🎉 ¡Plaza Disponible!',
    mensaje: `Se ha liberado una plaza para el ${data.fecha || ''} a las ${data.hora || ''}. ¡Confírmala!`
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
    // Verificar Server Key
    if (!FIREBASE_SERVER_KEY) {
      throw new Error('FIREBASE_SERVER_KEY no configurada');
    }

    const payload: NotificationRequest = await req.json();

    // Validar campos
    if (!payload.user_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'user_id es requerido' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!payload.tipo) {
      return new Response(
        JSON.stringify({ success: false, error: 'tipo es requerido' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Cliente Supabase con service key
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Obtener tokens FCM del usuario
    const { data: tokens, error: tokensError } = await supabase
      .from('fcm_tokens')
      .select('token, device_info')
      .eq('user_id', payload.user_id);

    if (tokensError) {
      console.error('Error obteniendo tokens:', tokensError);
      throw tokensError;
    }

    if (!tokens || tokens.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'El usuario no tiene dispositivos registrados'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Enviando a ${tokens.length} dispositivo(s)`);

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
          const response = await fetch('https://fcm.googleapis.com/fcm/send', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `key=${FIREBASE_SERVER_KEY}`
            },
            body: JSON.stringify({
              to: token,
              notification: {
                title: content.titulo,
                body: content.mensaje,
                icon: '/icons/icon-192x192.png',
                click_action: url
              },
              data: {
                tipo: payload.tipo,
                url: url,
                tag: `${payload.tipo}-${Date.now()}`,
                ...payload.data
              },
              webpush: {
                fcm_options: { link: url }
              }
            })
          });

          const result = await response.json();

          // Si token inválido, eliminarlo
          if (result.results?.[0]?.error === 'NotRegistered' ||
            result.results?.[0]?.error === 'InvalidRegistration') {
            console.log(`Token inválido, eliminando...`);
            await supabase.from('fcm_tokens').delete().eq('token', token);
          }

          return {
            device: device_info || 'unknown',
            success: result.success === 1,
            error: result.results?.[0]?.error
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

    // Guardar en historial de notificaciones (opcional)
    await supabase.from('notificaciones').insert({
      usuario_id: payload.user_id,
      tipo: payload.tipo,
      titulo: content.titulo,
      mensaje: content.mensaje,
      leida: false
    });

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