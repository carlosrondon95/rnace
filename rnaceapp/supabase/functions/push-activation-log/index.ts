import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import { verify } from 'djwt';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const JWT_SECRET = Deno.env.get('JWT_SECRET')!;
const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID') || '';
const ONESIGNAL_REST_API_KEY = Deno.env.get('ONESIGNAL_REST_API_KEY') || '';
const ONESIGNAL_LOOKUP_TIMEOUT_MS = 3000;
const ONESIGNAL_LOOKUP_CONCURRENCY = 5;
const ONESIGNAL_LOOKUP_MAX_USERS = 25;

type LogLevel = 'info' | 'warn' | 'error';
type PushSubscriptionSource = 'onesignal' | 'database' | 'none';

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

interface PushActivationLogRow {
  usuario_id: string | null;
}

interface PushSubscriptionRow {
  usuario_id: string;
  subscription_id: string | null;
  onesignal_id: string | null;
  external_id: string | null;
  opted_in: boolean;
  last_seen_at: string | null;
}

interface PushSubscriptionSummary {
  source: PushSubscriptionSource;
  count: number;
  active_count: number;
  latest_subscription_id: string | null;
  latest_onesignal_id: string | null;
  external_id: string | null;
  last_seen_at: string | null;
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

function emptySubscriptionSummary(source: PushSubscriptionSource = 'none'): PushSubscriptionSummary {
  return {
    source,
    count: 0,
    active_count: 0,
    latest_subscription_id: null,
    latest_onesignal_id: null,
    external_id: null,
    last_seen_at: null,
  };
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isPushSubscription(subscription: Record<string, unknown>): boolean {
  const type = String(subscription.type || '').toLowerCase();
  return !type || type.includes('push') || type.includes('web');
}

function isEnabledSubscription(subscription: Record<string, unknown>): boolean {
  return subscription.enabled !== false;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]);
    }
  });

  await Promise.all(workers);
  return results;
}

async function fetchOneSignalSubscriptionSummary(
  externalId: string,
): Promise<PushSubscriptionSummary | null> {
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
    return null;
  }

  try {
    const response = await fetchWithTimeout(
      `https://api.onesignal.com/apps/${encodeURIComponent(ONESIGNAL_APP_ID)}/users/by/external_id/${encodeURIComponent(externalId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Key ${ONESIGNAL_REST_API_KEY}`,
        },
      },
      ONESIGNAL_LOOKUP_TIMEOUT_MS,
    );

    if (response.status === 404) {
      return { ...emptySubscriptionSummary('onesignal'), external_id: externalId };
    }

    if (!response.ok) {
      console.warn('[PushLog] OneSignal no pudo devolver el usuario:', {
        external_id: externalId,
        status: response.status,
        error: await response.text(),
      });
      return null;
    }

    const body = (await response.json()) as {
      identity?: Record<string, unknown>;
      subscriptions?: Record<string, unknown>[];
    };
    const subscriptions = Array.isArray(body.subscriptions) ? body.subscriptions : [];
    const pushSubscriptions = subscriptions.filter(isPushSubscription);
    const enabledSubscriptions = pushSubscriptions.filter(isEnabledSubscription);
    const latest = enabledSubscriptions[0] || pushSubscriptions[0] || null;

    return {
      source: 'onesignal',
      count: pushSubscriptions.length,
      active_count: enabledSubscriptions.length,
      latest_subscription_id: latest ? textValue(latest.id) : null,
      latest_onesignal_id: textValue(body.identity?.onesignal_id),
      external_id: textValue(body.identity?.external_id) || externalId,
      last_seen_at: null,
    };
  } catch (error) {
    const message =
      error instanceof DOMException && error.name === 'AbortError'
        ? `Timeout OneSignal (${ONESIGNAL_LOOKUP_TIMEOUT_MS / 1000}s)`
        : error instanceof Error ? error.message : String(error);
    console.warn('[PushLog] Error consultando OneSignal:', {
      external_id: externalId,
      error: message,
    });
    return null;
  }
}

async function getSubscriptionSummaries(
  supabase: any,
  userIds: string[],
): Promise<Map<string, PushSubscriptionSummary>> {
  const summaries = new Map<string, PushSubscriptionSummary>();

  if (userIds.length === 0) {
    return summaries;
  }

  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('usuario_id, subscription_id, onesignal_id, external_id, opted_in, last_seen_at')
    .in('usuario_id', userIds)
    .eq('opted_in', true)
    .order('last_seen_at', { ascending: false });

  if (error) {
    console.warn('[PushLog] No se pudieron leer push_subscriptions:', error.message);
  } else {
    for (const row of (data || []) as PushSubscriptionRow[]) {
      const summary = summaries.get(row.usuario_id) || emptySubscriptionSummary('database');
      summary.source = 'database';
      summary.count += 1;
      summary.active_count += row.opted_in ? 1 : 0;

      if (!summary.latest_subscription_id) {
        summary.latest_subscription_id = row.subscription_id;
        summary.latest_onesignal_id = row.onesignal_id;
        summary.external_id = row.external_id;
        summary.last_seen_at = row.last_seen_at;
      }

      summaries.set(row.usuario_id, summary);
    }
  }

  const oneSignalLookupUserIds = userIds.slice(0, ONESIGNAL_LOOKUP_MAX_USERS);
  const oneSignalSummaries = await mapWithConcurrency(
    oneSignalLookupUserIds,
    ONESIGNAL_LOOKUP_CONCURRENCY,
    async (userId) => ({
      userId,
      summary: await fetchOneSignalSubscriptionSummary(userId),
    }),
  );

  for (const { userId, summary } of oneSignalSummaries) {
    if (!summary) continue;

    const current = summaries.get(userId);
    if (summary.count > 0 || !current) {
      summaries.set(userId, summary);
    }
  }

  return summaries;
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

      const logs = (data || []) as (Record<string, unknown> & PushActivationLogRow)[];
      const userIds = Array.from(
        new Set(logs.map((log) => log.usuario_id).filter((id): id is string => Boolean(id))),
      );
      const subscriptionSummaries = await getSubscriptionSummaries(supabase, userIds);
      const logsWithSubscriptions = logs.map((log) => ({
        ...log,
        push_subscription: log.usuario_id
          ? subscriptionSummaries.get(log.usuario_id) || emptySubscriptionSummary()
          : null,
      }));

      return jsonResponse({ success: true, logs: logsWithSubscriptions });
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
