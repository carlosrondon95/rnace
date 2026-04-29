import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import { verify } from 'djwt';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const JWT_SECRET = Deno.env.get('JWT_SECRET')!;

type LogLevel = 'info' | 'warn' | 'error';

interface PushActivationLogRequest {
  event?: string;
  level?: LogLevel;
  message?: string;
  details?: Record<string, unknown>;
  user_agent?: string | null;
}

interface Usuario {
  id: string;
  rol: string;
  activo: boolean;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-rnace-token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function authError(message: string, status = 401): Response {
  return jsonResponse({ success: false, error: message }, status);
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

function sanitizeDetails(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'Metodo no permitido' }, 405);
  }

  try {
    const userId = await verifyUserToken(req);
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: usuario, error: userError } = await supabase
      .from('usuarios')
      .select('id, rol, activo')
      .eq('id', userId)
      .single();

    const usuarioActual = usuario as Usuario | null;

    if (userError || !usuarioActual) {
      return jsonResponse({ success: false, error: 'Usuario no encontrado' }, 404);
    }

    if (!usuarioActual.activo) {
      return jsonResponse({ success: false, error: 'Usuario inactivo' }, 403);
    }

    if (req.method === 'GET') {
      if (usuarioActual.rol !== 'admin') {
        return jsonResponse({ success: false, error: 'Solo admin' }, 403);
      }

      const url = new URL(req.url);
      const limitParam = Number(url.searchParams.get('limit') || '100');
      const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 100;

      const { data, error } = await supabase
        .from('push_activation_logs')
        .select(`
          id,
          usuario_id,
          usuario_rol,
          event,
          level,
          message,
          details,
          user_agent,
          created_at,
          usuarios (
            nombre,
            telefono,
            rol
          )
        `)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[PushLog] Error listando logs:', error);
        return jsonResponse({ success: false, error: error.message }, 500);
      }

      return jsonResponse({ success: true, logs: data || [] });
    }

    const payload = (await req.json()) as PushActivationLogRequest;
    const event = String(payload.event || '').trim().slice(0, 120);
    const level = payload.level === 'warn' || payload.level === 'error' ? payload.level : 'info';

    if (!event) {
      return jsonResponse({ success: false, error: 'event es requerido' }, 400);
    }

    const { error } = await supabase.from('push_activation_logs').insert({
      usuario_id: userId,
      usuario_rol: usuarioActual.rol,
      event,
      level,
      message: payload.message ? String(payload.message).slice(0, 500) : null,
      details: sanitizeDetails(payload.details),
      user_agent: payload.user_agent ? String(payload.user_agent).slice(0, 500) : null,
    });

    if (error) {
      console.error('[PushLog] Error guardando log:', error);
      return jsonResponse({ success: false, error: error.message }, 500);
    }

    return jsonResponse({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;

    console.error('[PushLog] Error:', error);
    return jsonResponse(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});
