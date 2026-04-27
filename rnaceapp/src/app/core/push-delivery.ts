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
