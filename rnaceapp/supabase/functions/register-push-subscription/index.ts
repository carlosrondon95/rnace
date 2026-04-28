import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import { verify } from 'djwt';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const JWT_SECRET = Deno.env.get('JWT_SECRET')!;

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
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-rnace-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
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
    throw new Response(JSON.stringify({ success: false, error: 'Token requerido' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const payload = await verify(token, key);
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new Response(JSON.stringify({ success: false, error: 'Token invalido' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return payload.sub;
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
    const { error: upsertError } = await supabase.from('push_subscriptions').upsert(
      {
        usuario_id: payload.usuario_id,
        subscription_id: payload.subscription_id,
        token: payload.token ?? null,
        onesignal_id: payload.onesignal_id ?? null,
        external_id: payload.external_id ?? null,
        opted_in: payload.opted_in !== false,
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

    return jsonResponse({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;

    console.error('[Push] Error registrando subscription:', error);
    return jsonResponse(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});
