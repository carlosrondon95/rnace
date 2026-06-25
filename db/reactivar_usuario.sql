-- RPC para REACTIVAR un usuario partiendo de cero.
-- Ejecutar UNA VEZ en el SQL Editor de Supabase.
--
-- Filosofía: al reactivar NO se intenta restaurar el estado previo del usuario,
-- sino que se "empieza desde cero" con su horario base:
--   1. Marcarlo activo (vuelve a poder iniciar sesión).
--   2. Anular TODAS sus recuperaciones (disponible + usada → caducada): vuelve
--      sin ningún crédito de recuperación.
--   3. Regenerar sus reservas futuras SOLO a partir de horario_fijo_usuario:
--        a) reactivar las filas existentes (p.ej. las canceladas al desactivarlo)
--           cuya sesión coincide con su horario base;
--        b) insertar las que falten.
--      Las reservas previas que NO coinciden con el horario base (puntuales,
--      recuperaciones, slots ya retirados de su plantilla) se quedan canceladas.
--
-- Por qué un RPC propio y no regenerar_reservas_futuras(reactivar=true):
--   esa función solo reactiva reservas con cancelada_por_sync = true (o
--   cancelada_correctamente = false). desactivar_usuario deja
--   cancelada_correctamente = true y cancelada_por_sync = false, así que NO las
--   reactivaría: la reactivación vía sync estaba, de hecho, sin efecto para los
--   usuarios desactivados. Este RPC lo resuelve de forma explícita y auditable.
--
-- El emparejamiento horario_fijo_usuario → horarios_disponibles → sesiones usa
-- la misma lógica (modalidad + hora + dia_semana = isodow(fecha)) que
-- regenerar_reservas_futuras para no divergir.
--
-- Es SECURITY DEFINER para no depender de la RLS sobre usuarios/reservas/recuperaciones.

create or replace function public.reactivar_usuario(p_usuario_id uuid)
returns table (
  ok boolean,
  reservas_activadas integer,
  recuperaciones_anuladas integer,
  mensaje text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ahora timestamptz := now();
  v_react integer := 0;
  v_ins integer := 0;
  v_reservas_activadas integer := 0;
  v_recups_anuladas integer := 0;
begin
  -- 1. Marcar activo.
  update usuarios
  set activo = true,
      actualizado_en = v_ahora
  where id = p_usuario_id;

  -- 2. Anular todas las recuperaciones: empieza sin crédito de recuperación.
  update recuperaciones
  set estado = 'caducada'
  where usuario_id = p_usuario_id
    and estado in ('disponible', 'usada');
  get diagnostics v_recups_anuladas = row_count;

  -- 3. Regenerar reservas futuras solo desde el horario base.
  --    Un único statement: cada sesión del horario base o ya tiene fila (la
  --    reactiva 'react') o no la tiene (la inserta 'ins'); no se solapan.
  with base as (
    select s.id as sesion_id
    from horario_fijo_usuario hfu
    join horarios_disponibles hd
      on hd.id = hfu.horario_disponible_id
    join sesiones s
      on s.modalidad = hd.modalidad
      and s.hora = hd.hora
      and extract(isodow from s.fecha)::integer = hd.dia_semana
    where hfu.usuario_id = p_usuario_id
      and hfu.activo = true
      and hd.activo = true
      and s.fecha >= current_date
      and coalesce(s.cancelada, false) = false
      and not exists (
        select 1 from festivos f where f.fecha = s.fecha
      )
  ),
  react as (
    update reservas r
    set estado = 'activa',
        es_recuperacion = false,
        es_desde_horario_fijo = true,
        cancelada_en = null,
        cancelada_correctamente = false,
        cancelada_por_sync = false
    from base b
    where r.sesion_id = b.sesion_id
      and r.usuario_id = p_usuario_id
      and r.estado <> 'activa'
    returning 1
  ),
  ins as (
    insert into reservas (
      sesion_id,
      usuario_id,
      estado,
      es_recuperacion,
      es_desde_horario_fijo,
      cancelada_en,
      cancelada_correctamente,
      cancelada_por_sync
    )
    select
      b.sesion_id,
      p_usuario_id,
      'activa',
      false,
      true,
      null,
      false,
      false
    from base b
    where not exists (
      select 1 from reservas r
      where r.sesion_id = b.sesion_id
        and r.usuario_id = p_usuario_id
    )
    on conflict (sesion_id, usuario_id) do nothing
    returning 1
  )
  select
    (select count(*) from react)::integer,
    (select count(*) from ins)::integer
  into v_react, v_ins;

  v_reservas_activadas := v_react + v_ins;

  return query
  select
    true,
    v_reservas_activadas,
    v_recups_anuladas,
    format(
      'Usuario reactivado desde cero. Horario base restaurado (%s reservas) y %s recuperaciones anuladas.',
      v_reservas_activadas,
      v_recups_anuladas
    )::text;
end;
$$;

grant execute on function public.reactivar_usuario(uuid) to anon;
grant execute on function public.reactivar_usuario(uuid) to authenticated;
