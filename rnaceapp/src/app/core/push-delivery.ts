import { supabase } from './supabase.client';

export type PushTipo = 'reserva_cancelada' | 'admin' | 'plaza_asignada' | 'hueco_disponible';

export interface PushDeliveryRequest {
  user_id: string;
  tipo: PushTipo;
  titulo?: string;
  mensaje?: string;
  data?: Record<string, string>;
}

export interface PushDeliveryResult {
  ok: boolean;
  skipped: boolean;
  error?: string;
  onesignalId?: string;
}

function getSesionId(data?: Record<string, string>): number | null {
  const raw = data?.['sesion_id'] || data?.['sesionId'];
  const explicit = raw ? Number(raw) : Number.NaN;
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const match = data?.['url']?.match(/sesion=(\d+)/);
  if (!match) return null;

  const fromUrl = Number(match[1]);
  return Number.isFinite(fromUrl) && fromUrl > 0 ? fromUrl : null;
}

async function asegurarNotificacionInternaHueco(
  userId: string,
  data: Record<string, string> | undefined,
  contexto: string,
): Promise<void> {
  const sesionId = getSesionId(data);
  const accionUrl = data?.['url'] || (sesionId ? `/calendario?sesion=${sesionId}` : '/calendario');

  const { data: existentes, error: selectError } = await supabase()
    .from('notificaciones')
    .select('id,sesion_id,accion_url')
    .eq('usuario_id', userId)
    .eq('tipo', 'hueco_disponible')
    .order('creado_en', { ascending: false })
    .limit(50);

  if (selectError) {
    console.warn(`[Notificaciones] ${contexto}: no se pudo comprobar duplicados internos`, selectError);
    return;
  }

  const yaExiste = (existentes || []).some((notificacion) => {
    const mismaSesion = sesionId !== null && Number(notificacion.sesion_id) === sesionId;
    const mismaUrl = Boolean(accionUrl && notificacion.accion_url === accionUrl);
    return mismaSesion || mismaUrl;
  });

  if (yaExiste) return;

  const mensaje =
    data?.['mensaje'] ||
    `Hay plaza en la clase de ${data?.['modalidad'] || ''} del ${data?.['fecha'] || ''} a las ${data?.['hora'] || ''}.`;

  const payload: Record<string, unknown> = {
    usuario_id: userId,
    tipo: 'hueco_disponible',
    titulo: data?.['titulo'] || 'Plaza disponible',
    mensaje,
    accion_url: accionUrl,
  };

  if (sesionId !== null) payload['sesion_id'] = sesionId;

  const { error: insertError } = await supabase().from('notificaciones').insert(payload);
  if (insertError) {
    console.warn(`[Notificaciones] ${contexto}: no se pudo crear la notificacion interna`, insertError);
  }
}

export async function enviarPushUsuario(
  body: PushDeliveryRequest,
  contexto: string,
): Promise<PushDeliveryResult> {
  const { data, error } = await supabase().functions.invoke('send-push', { body });

  if (error) {
    console.warn(`[Push] ${contexto}: error invocando send-push`, error);
    return { ok: false, skipped: false, error: error.message };
  }

  if (data?.skipped) {
    const message = data.message || data.error || 'Notificacion omitida';
    console.info(`[Push] ${contexto}: ${message}`);
    return { ok: Boolean(data.success), skipped: true, error: message };
  }

  if (!data?.success) {
    const message = data?.error || 'OneSignal no acepto el envio';
    console.warn(`[Push] ${contexto}: ${message}`);
    return { ok: false, skipped: false, error: message };
  }

  return { ok: true, skipped: false, onesignalId: data.onesignal_id };
}

export async function enviarHuecoDisponibleUsuario(
  body: Omit<PushDeliveryRequest, 'tipo'>,
  contexto: string,
): Promise<PushDeliveryResult> {
  await asegurarNotificacionInternaHueco(body.user_id, body.data, contexto);
  return enviarPushUsuario({ ...body, tipo: 'hueco_disponible' }, contexto);
}
