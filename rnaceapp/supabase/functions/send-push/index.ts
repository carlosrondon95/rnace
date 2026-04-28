import { serve } from 'std/http/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID')!;
const ONESIGNAL_REST_API_KEY = Deno.env.get('ONESIGNAL_REST_API_KEY')!;

type NotificationTipo =
  | 'cancelacion'
  | 'reserva_cancelada'
  | 'admin'
  | 'admin_info'
  | 'admin_warning'
  | 'admin_urgent'
  | 'admin_promo'
  | 'plaza_asignada'
  | 'hueco_disponible';

type CanonicalNotificationTipo = Exclude<NotificationTipo, 'reserva_cancelada' | 'admin'>;

interface NotificationRequest {
  // usuario_id es el nombre canonico de la BD. user_id se acepta como alias legacy.
  usuario_id?: string;
  user_id?: string;
  tipo: NotificationTipo;
  titulo?: string;
  mensaje?: string;
  data?: Record<string, string>;
}

type OneSignalTarget = 'external_id' | 'subscription_id';

interface OneSignalResult {
  success: boolean;
  id?: string;
  error?: string;
  recipients?: number | null;
  target?: OneSignalTarget;
}

const cancelacionTemplate = (data: Record<string, string>) => ({
  titulo: data.titulo || 'Reserva Cancelada',
  mensaje:
    data.mensaje ||
    `Tu reserva del ${data.fecha || ''} a las ${data.hora || ''} ha sido cancelada.`,
});

const TEMPLATES: Record<
  CanonicalNotificationTipo,
  (data: Record<string, string>) => { titulo: string; mensaje: string }
> = {
  cancelacion: cancelacionTemplate,

  plaza_asignada: (data) => ({
    titulo: 'Plaza Asignada',
    mensaje:
      data.mensaje ||
      `Se te ha asignado plaza en la clase de ${data.modalidad || ''} del ${data.fecha || ''} a las ${data.hora || ''}.`,
  }),

  hueco_disponible: (data) => ({
    titulo: 'Hay una plaza disponible',
    mensaje:
      data.mensaje ||
      `Hay plaza en la clase de ${data.modalidad || ''} del ${data.fecha || ''} a las ${data.hora || ''}.`,
  }),

  admin_info: (data) => ({
    titulo: data.titulo || 'Aviso del Centro',
    mensaje: data.mensaje || 'Tienes un nuevo mensaje del centro.',
  }),

  admin_warning: (data) => ({
    titulo: data.titulo || 'Aviso del Centro',
    mensaje: data.mensaje || 'Tienes un nuevo mensaje del centro.',
  }),

  admin_urgent: (data) => ({
    titulo: data.titulo || 'Aviso del Centro',
    mensaje: data.mensaje || 'Tienes un nuevo mensaje del centro.',
  }),

  admin_promo: (data) => ({
    titulo: data.titulo || 'Aviso del Centro',
    mensaje: data.mensaje || 'Tienes un nuevo mensaje del centro.',
  }),
};

function normalizeTipo(tipo: NotificationTipo): CanonicalNotificationTipo {
  if (tipo === 'admin') return 'admin_info';
  return tipo === 'reserva_cancelada' ? 'cancelacion' : tipo;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function sendOneSignalNotification(
  userId: string,
  titulo: string,
  mensaje: string,
  data: Record<string, string>,
  fallbackSubscriptionIds: string[],
): Promise<OneSignalResult> {
  let url = data.url;
  if (!url) {
    switch (data.tipo) {
      case 'plaza_asignada':
      case 'hueco_disponible':
        url = '/calendario';
        break;
      case 'cancelacion':
      case 'admin_info':
      case 'admin_warning':
      case 'admin_urgent':
      case 'admin_promo':
      default:
        url = '/notificaciones';
        break;
    }
  }

  const body: Record<string, unknown> = {
    app_id: ONESIGNAL_APP_ID,
    headings: { en: titulo },
    contents: { en: mensaje },
    web_url: `https://centrornace.com${url}`,
    data: {
      ...data,
      tipo: data.tipo || 'default',
      url,
    },
    chrome_web_icon: 'https://centrornace.com/assets/icons/icon-192x192.png',
    chrome_web_badge: 'https://centrornace.com/assets/icons/icon-72x72.png',
    ttl: 86400,
    priority: 10,
  };

  const externalIdResult = await postOneSignalNotification(
    {
      ...body,
      include_aliases: { external_id: [userId] },
      target_channel: 'push',
    },
    'external_id',
  );

  if (externalIdResult.success) {
    return externalIdResult;
  }

  if (fallbackSubscriptionIds.length === 0) {
    return externalIdResult;
  }

  const relinked = await relinkSubscriptionsToExternalId(userId, fallbackSubscriptionIds);
  if (relinked > 0) {
    const relinkedExternalIdResult = await postOneSignalNotification(
      {
        ...body,
        include_aliases: { external_id: [userId] },
        target_channel: 'push',
      },
      'external_id',
    );

    if (relinkedExternalIdResult.success) {
      return relinkedExternalIdResult;
    }
  }

  console.warn('[OneSignal] Sin destinatarios por external_id; reintentando por subscription_id', {
    usuario_id: userId,
    external_id_error: externalIdResult.error,
    external_id_recipients: externalIdResult.recipients,
    subscriptions: fallbackSubscriptionIds.length,
  });

  return await postOneSignalNotification(
    {
      ...body,
      include_subscription_ids: fallbackSubscriptionIds,
      target_channel: 'push',
    },
    'subscription_id',
  );
}

async function relinkSubscriptionsToExternalId(
  externalId: string,
  subscriptionIds: string[],
): Promise<number> {
  const results = await Promise.all(
    subscriptionIds.map((subscriptionId) =>
      transferSubscriptionToExternalId(subscriptionId, externalId),
    ),
  );

  return results.filter(Boolean).length;
}

async function transferSubscriptionToExternalId(
  subscriptionId: string,
  externalId: string,
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.onesignal.com/apps/${encodeURIComponent(ONESIGNAL_APP_ID)}/subscriptions/${encodeURIComponent(subscriptionId)}/owner`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Key ${ONESIGNAL_REST_API_KEY}`,
        },
        body: JSON.stringify({
          identity: {
            external_id: externalId,
          },
        }),
      },
    );

    if (response.ok) {
      return true;
    }

    const errorText = await response.text();
    console.warn('[OneSignal] No se pudo vincular subscription antes del envio:', {
      subscription_id: subscriptionId,
      external_id: externalId,
      status: response.status,
      error: errorText || `HTTP ${response.status}`,
    });
    return false;
  } catch (error) {
    console.warn('[OneSignal] Error vinculando subscription antes del envio:', {
      subscription_id: subscriptionId,
      external_id: externalId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function postOneSignalNotification(
  body: Record<string, unknown>,
  target: OneSignalTarget,
): Promise<OneSignalResult> {
  const response = await fetch('https://api.onesignal.com/notifications?c=push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Key ${ONESIGNAL_REST_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  let result: Record<string, any> = {};
  try {
    result = responseText ? JSON.parse(responseText) : {};
  } catch {
    result = { errors: responseText || `HTTP ${response.status}` };
  }

  if (!response.ok || result.errors) {
    const errorMsg = result.errors
      ? Array.isArray(result.errors)
        ? result.errors.join(', ')
        : JSON.stringify(result.errors)
      : `HTTP ${response.status}`;
    console.error('[OneSignal] Error:', { target, error: errorMsg });
    return { success: false, error: errorMsg, target };
  }

  const recipients = typeof result.recipients === 'number' ? result.recipients : null;
  if (!result.id || recipients === 0) {
    const errorMsg =
      recipients === 0
        ? `OneSignal no encontro subscriptions para este ${target}`
        : 'OneSignal no devolvio notification id';
    console.warn('[OneSignal] Sin destinatarios validos:', {
      target,
      notification_id: result.id ?? null,
      recipients,
    });
    return { success: false, error: errorMsg, recipients, target };
  }

  return { success: true, id: result.id, recipients, target };
}

async function getFallbackSubscriptionIds(
  supabase: ReturnType<typeof createClient>,
  usuarioId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('subscription_id')
    .eq('usuario_id', usuarioId)
    .eq('opted_in', true)
    .order('last_seen_at', { ascending: false })
    .limit(20);

  if (error) {
    console.warn('[Push] No se pudieron leer fallback subscription_ids:', error.message);
    return [];
  }

  return Array.from(
    new Set((data || []).map((row) => String(row.subscription_id || '').trim()).filter(Boolean)),
  );
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Metodo no permitido' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    let payload: NotificationRequest;
    try {
      payload = await req.json();
    } catch {
      return new Response(JSON.stringify({ success: false, error: 'JSON invalido' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const usuarioId = payload.usuario_id || payload.user_id;

    if (!usuarioId) {
      return new Response(JSON.stringify({ success: false, error: 'usuario_id es requerido' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!payload.tipo) {
      return new Response(JSON.stringify({ success: false, error: 'tipo es requerido' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const tipo = normalizeTipo(payload.tipo);
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { data: usuario, error: userError } = await supabase
      .from('usuarios')
      .select('activo')
      .eq('id', usuarioId)
      .single();

    if (userError || !usuario) {
      return new Response(JSON.stringify({ success: false, message: 'Usuario no encontrado' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!usuario.activo) {
      console.log(`Usuario ${usuarioId} inactivo. Omitiendo notificacion.`);
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Usuario inactivo. Notificacion omitida.',
          skipped: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const template = TEMPLATES[tipo];
    const content = template
      ? template(payload.data || {})
      : { titulo: payload.titulo || 'RNACE', mensaje: payload.mensaje || '' };

    console.log(`[OneSignal] Enviando "${content.titulo}" a usuario ${usuarioId}`);
    const fallbackSubscriptionIds = await getFallbackSubscriptionIds(supabase, usuarioId);

    const result = await sendOneSignalNotification(
      usuarioId,
      content.titulo,
      content.mensaje,
      {
        ...Object.fromEntries(Object.entries(payload.data || {}).map(([k, v]) => [k, String(v)])),
        tipo,
      },
      fallbackSubscriptionIds,
    );

    return new Response(
      JSON.stringify({
        success: result.success,
        onesignal_id: result.id,
        recipients: result.recipients,
        target: result.target,
        error: result.error,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
