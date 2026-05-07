-- Fix: usar_recuperacion failed when the user/session already had a cancelled
-- reserva row. The unique constraint is on (sesion_id, usuario_id), so the RPC
-- must reactivate an existing cancelled row instead of always inserting.

drop function if exists public.usar_recuperacion(uuid, integer);
drop function if exists public.usar_recuperacion(uuid, bigint);

create or replace function public.usar_recuperacion(
  p_usuario_id uuid,
  p_sesion_id bigint
)
returns table (
  ok boolean,
  mensaje text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sesion record;
  v_recuperacion record;
  v_reserva_id bigint := null;
  v_reserva_estado text := null;
  v_plazas_ocupadas integer := 0;
  v_mes_sesion integer;
  v_anio_sesion integer;
begin
  /*
    Serialize attempts for the same user/session. This avoids double-clicks or
    parallel clients consuming two recuperaciones for one final reserva row.
  */
  perform pg_advisory_xact_lock(
    hashtextextended(p_usuario_id::text || ':' || p_sesion_id::text, 0)
  );

  select
    s.id,
    s.fecha,
    s.hora,
    s.modalidad,
    s.capacidad,
    coalesce(s.cancelada, false) as cancelada
  into v_sesion
  from sesiones s
  where s.id = p_sesion_id
  for update;

  if not found then
    return query select false, 'La sesion no existe.';
    return;
  end if;

  if v_sesion.cancelada then
    return query select false, 'Esta clase esta cancelada.';
    return;
  end if;

  if (v_sesion.fecha + v_sesion.hora::time) < now() then
    return query select false, 'No se puede reservar una clase pasada.';
    return;
  end if;

  v_mes_sesion := extract(month from v_sesion.fecha)::integer;
  v_anio_sesion := extract(year from v_sesion.fecha)::integer;

  select r.id, r.estado
  into v_reserva_id, v_reserva_estado
  from reservas r
  where r.sesion_id = p_sesion_id
    and r.usuario_id = p_usuario_id
  for update;

  if v_reserva_estado = 'activa' then
    return query select false, 'Ya tienes una reserva activa en esta clase.';
    return;
  end if;

  select count(*)::integer
  into v_plazas_ocupadas
  from reservas r
  where r.sesion_id = p_sesion_id
    and r.estado = 'activa';

  if v_plazas_ocupadas >= v_sesion.capacidad then
    return query select false, 'No quedan plazas disponibles en esta clase.';
    return;
  end if;

  select r.*
  into v_recuperacion
  from recuperaciones r
  cross join lateral (
    select
      case
        when r.mes_limite <> r.mes_origen
          and exists (
            select 1
            from recuperaciones usada
            where usada.usuario_id = r.usuario_id
              and usada.estado = 'usada'
              and usada.mes_uso = r.mes_limite
              and usada.anio_uso = r.anio_limite
              and (
                usada.mes_origen <> usada.mes_uso
                or usada.anio_origen <> usada.anio_uso
              )
          )
        then r.mes_origen
        else r.mes_limite
      end as mes_limite_efectivo,
      case
        when r.mes_limite <> r.mes_origen
          and exists (
            select 1
            from recuperaciones usada
            where usada.usuario_id = r.usuario_id
              and usada.estado = 'usada'
              and usada.mes_uso = r.mes_limite
              and usada.anio_uso = r.anio_limite
              and (
                usada.mes_origen <> usada.mes_uso
                or usada.anio_origen <> usada.anio_uso
              )
          )
        then r.anio_origen
        else r.anio_limite
      end as anio_limite_efectivo
  ) limites
  where r.usuario_id = p_usuario_id
    and r.estado = 'disponible'
    and (r.modalidad = v_sesion.modalidad or r.modalidad = 'hibrido')
    and (v_anio_sesion > r.anio_origen
      or (v_anio_sesion = r.anio_origen and v_mes_sesion >= r.mes_origen))
    and (v_anio_sesion < limites.anio_limite_efectivo
      or (v_anio_sesion = limites.anio_limite_efectivo and v_mes_sesion <= limites.mes_limite_efectivo))
  order by r.anio_origen asc, r.mes_origen asc, r.id asc
  limit 1
  for update of r skip locked;

  if not found then
    return query select false, 'No tienes recuperaciones disponibles para esta clase.';
    return;
  end if;

  if v_reserva_id is not null then
    update reservas r
    set
      estado = 'activa',
      es_recuperacion = true,
      es_desde_horario_fijo = false,
      cancelada_en = null,
      cancelada_correctamente = false,
      cancelada_por_sync = false
    where r.id = v_reserva_id;
  else
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
    values (
      p_sesion_id,
      p_usuario_id,
      'activa',
      true,
      false,
      null,
      false,
      false
    );
  end if;

  update recuperaciones r
  set
    estado = 'usada',
    fecha_uso = now(),
    sesion_uso_id = p_sesion_id,
    mes_uso = v_mes_sesion,
    anio_uso = v_anio_sesion
  where r.id = v_recuperacion.id;

  delete from lista_espera le
  where le.usuario_id = p_usuario_id
    and le.sesion_id = p_sesion_id;

  return query select true, 'Recuperacion usada correctamente.';
end;
$$;

grant execute on function public.usar_recuperacion(uuid, bigint) to anon;
grant execute on function public.usar_recuperacion(uuid, bigint) to authenticated;
