-- RPC para cerrar / reabrir un grupo (sesión) puntual desde el panel de admin.
-- Ejecutar UNA VEZ en el SQL Editor de Supabase.
--
-- Marca una sesión como cancelada (cancelada = true) para que deje de aparecer
-- en las reservas (toda la app ya filtra por cancelada = false), o la reabre
-- (cancelada = false). Es SECURITY DEFINER para no depender de la RLS de UPDATE
-- sobre la tabla sesiones.
--
-- La cancelación de las reservas que hubiera en la sesión la hace el frontend
-- reutilizando el RPC existente cancelar_reserva_admin (recuperación + push).

create or replace function set_sesion_cancelada(
  p_sesion_id bigint,
  p_cancelada boolean,
  p_motivo text default null
) returns void
language sql
security definer
set search_path = public
as $$
  update sesiones
  set cancelada = p_cancelada,
      motivo_cancelacion = case when p_cancelada then p_motivo else null end
  where id = p_sesion_id;
$$;
