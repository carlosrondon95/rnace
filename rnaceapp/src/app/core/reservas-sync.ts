import type { SupabaseClient } from '@supabase/supabase-js';

export interface ReservaSyncConflict {
  usuario_id?: string;
  nombre?: string;
  telefono?: string;
  sesion_id?: number;
  fecha?: string;
  hora?: string;
  modalidad?: string;
}

export interface ReservaSyncResult {
  ok: boolean;
  reservas_canceladas: number;
  reservas_creadas: number;
  conflictos: ReservaSyncConflict[];
  mensaje?: string;
}

export class ReservaSyncError extends Error {
  constructor(public readonly resultado: ReservaSyncResult) {
    super(formatearResultadoReservas(resultado));
    this.name = 'ReservaSyncError';
  }
}

export async function regenerarReservasFuturas(
  client: SupabaseClient,
  usuarioId?: string,
): Promise<ReservaSyncResult> {
  const { data, error } = await client.rpc(
    'regenerar_reservas_futuras',
    usuarioId ? { p_usuario_id: usuarioId } : {},
  );

  if (error) {
    throw error;
  }

  return normalizarResultadoReservas(data);
}

export async function asegurarReservasFuturasSincronizadas(
  client: SupabaseClient,
  usuarioId?: string,
): Promise<ReservaSyncResult> {
  const resultado = await regenerarReservasFuturas(client, usuarioId);

  if (!resultado.ok || resultado.conflictos.length > 0) {
    throw new ReservaSyncError(resultado);
  }

  return resultado;
}

export function formatearResultadoReservas(resultado: ReservaSyncResult): string {
  if (resultado.mensaje && resultado.conflictos.length === 0) {
    return resultado.mensaje;
  }

  if (resultado.conflictos.length === 0) {
    return 'Reservas futuras sincronizadas correctamente.';
  }

  const ejemplos = resultado.conflictos.slice(0, 3).map((conflicto) => {
    const alumno = conflicto.nombre || conflicto.telefono || 'alumno';
    const fecha = conflicto.fecha
      ? conflicto.fecha.split('-').reverse().join('/')
      : 'fecha pendiente';
    const hora = conflicto.hora ? conflicto.hora.substring(0, 5) : 'hora pendiente';
    return `${alumno} (${fecha} ${hora})`;
  });

  const restantes = resultado.conflictos.length - ejemplos.length;
  const sufijo = restantes > 0 ? ` y ${restantes} más` : '';

  return `No se pudieron crear automáticamente ${resultado.conflictos.length} reservas fijas: ${ejemplos.join(', ')}${sufijo}.`;
}

function normalizarResultadoReservas(data: unknown): ReservaSyncResult {
  const fila = Array.isArray(data) ? data[0] : data;

  if (!esObjeto(fila)) {
    return {
      ok: true,
      reservas_canceladas: 0,
      reservas_creadas: 0,
      conflictos: [],
    };
  }

  const conflictos = normalizarConflictos(fila['conflictos']);

  return {
    ok: typeof fila['ok'] === 'boolean' ? fila['ok'] : conflictos.length === 0,
    reservas_canceladas: normalizarNumero(fila['reservas_canceladas']),
    reservas_creadas: normalizarNumero(fila['reservas_creadas']),
    conflictos,
    mensaje: typeof fila['mensaje'] === 'string' ? fila['mensaje'] : undefined,
  };
}

function normalizarConflictos(value: unknown): ReservaSyncConflict[] {
  if (!Array.isArray(value)) return [];

  return value.filter(esObjeto).map((conflicto) => ({
    usuario_id: normalizarTexto(conflicto['usuario_id']),
    nombre: normalizarTexto(conflicto['nombre']),
    telefono: normalizarTexto(conflicto['telefono']),
    sesion_id: normalizarNumeroOpcional(conflicto['sesion_id']),
    fecha: normalizarTexto(conflicto['fecha']),
    hora: normalizarTexto(conflicto['hora']),
    modalidad: normalizarTexto(conflicto['modalidad']),
  }));
}

function normalizarNumero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizarNumeroOpcional(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizarTexto(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function esObjeto(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
