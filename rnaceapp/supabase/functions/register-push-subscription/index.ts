import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import { verify } from 'djwt';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const JWT_SECRET = Deno.env.get('JWT_SECRET')!;
const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID') || '';
const ONESIGNAL_REST_API_KEY = Deno.env.get('ONESIGNAL_REST_API_KEY') || '';

interface RegisterPushSubscriptionRequest {
  usuario_id?: string;
  subscription_id?: string;
  token?: string | null;
  onesignal_id?: string | null;
  external_id?: string | null;
  opted_in?: boolean;
  user_agent?: string | null;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-rnace-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function authError(message: string, status = 401): Response {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function verifyUserToken(req: Request): Promise<string> {
  const rnaceToken = req.headers.get('x-rnace-token') || '';
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization') || '';
  const [, bearerToken] = authHeader.match(/^Bearer\s+(.+)$/i) || [];
  const token = rnaceToken || bearerToken;

  if (!token) {
    throw authError('Token requerido');
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  let payload: Record<string, unknown>;
  try {
    payload = await verify(token, key);
  } catch {
    throw authError('Token invalido');
  }

  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw authError('Token invalido');
  }

  return payload.sub;
}

async function linkSubscriptionToExternalId(
  subscriptionId: string,
  externalId: string,
): Promise<{ linked: boolean; skipped?: boolean; error?: string }> {
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
    console.warn(
      '[Push] No se pudo vincular en OneSignal: faltan ONESIGNAL_APP_ID/ONESIGNAL_REST_API_KEY',
    );
    return { linked: false, skipped: true, error: 'OneSignal no configurado' };
  }

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
      return { linked: true };
    }

    const responseText = await response.text();
    const error = responseText || `HTTP ${response.status}`;
    console.warn('[Push] OneSignal no pudo vincular subscription con external_id:', {
      subscription_id: subscriptionId,
      external_id: externalId,
      status: response.status,
      error,
    });
    return { linked: false, error };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[Push] Error vinculando subscription con external_id:', {
      subscription_id: subscriptionId,
      external_id: externalId,
      error: message,
    });
    return { linked: false, error: message };
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Metodo no permitido' }, 405);
  }

  try {
    const tokenUserId = await verifyUserToken(req);
    const payload = (await req.json()) as RegisterPushSubscriptionRequest;

    if (!payload.usuario_id || payload.usuario_id !== tokenUserId) {
      return jsonResponse({ success: false, error: 'usuario_id no coincide con el token' }, 403);
    }

    if (!payload.subscription_id) {
      return jsonResponse({ success: false, error: 'subscription_id es requerido' }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: usuario, error: userError } = await supabase
      .from('usuarios')
      .select('activo')
      .eq('id', payload.usuario_id)
      .single();

    if (userError || !usuario) {
      return jsonResponse({ success: false, error: 'Usuario no encontrado' }, 404);
    }

    if (!usuario.activo) {
      return jsonResponse({ success: true, skipped: true, message: 'Usuario inactivo' });
    }

    const now = new Date().toISOString();
    const externalId = payload.usuario_id;
    const optedIn = payload.opted_in !== false;
    const { error: upsertError } = await supabase.from('push_subscriptions').upsert(
      {
        usuario_id: payload.usuario_id,
        subscription_id: payload.subscription_id,
        token: payload.token ?? null,
        onesignal_id: payload.onesignal_id ?? null,
        external_id: externalId,
        opted_in: optedIn,
        user_agent: payload.user_agent ? payload.user_agent.slice(0, 500) : null,
        last_seen_at: now,
        updated_at: now,
      },
      { onConflict: 'subscription_id' },
    );

    if (upsertError) {
      console.error('[Push] Error guardando subscription:', upsertError);
      return jsonResponse({ success: false, error: upsertError.message }, 500);
    }

    const linkResult = optedIn
      ? await linkSubscriptionToExternalId(payload.subscription_id, externalId)
      : { linked: false, skipped: true };

    return jsonResponse({
      success: true,
      onesignal_linked: linkResult.linked,
      link_skipped: linkResult.skipped ?? false,
    });
  } catch (error) {
    if (error instanceof Response) return error;

    console.error('[Push] Error registrando subscription:', error);
    return jsonResponse(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});
