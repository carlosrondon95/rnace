alter table public.reservas
  add column if not exists cancelada_por_sync boolean not null default false;

drop function if exists public.regenerar_reservas_futuras(uuid, boolean, date, date);
drop function if exists public.regenerar_reservas_futuras(uuid, boolean);
drop function if exists public.regenerar_reservas_futuras(uuid);
drop function if exists public.regenerar_reservas_futuras();

create or replace function public.regenerar_reservas_futuras(
  p_usuario_id uuid default null,
  p_reactivar_canceladas boolean default false,
  p_fecha_desde date default null,
  p_fecha_hasta date default null
)
returns table (
  ok boolean,
  reservas_canceladas integer,
  reservas_creadas integer,
  conflictos jsonb,
  mensaje text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservas_canceladas integer := 0;
  v_reservas_insertadas integer := 0;
  v_reservas_reactivadas integer := 0;
  v_reservas_normalizadas integer := 0;
  v_reservas_creadas integer := 0;
  v_conflictos jsonb := '[]'::jsonb;
  v_fecha_desde date := current_date;
  v_fecha_hasta date := null;
begin
  v_fecha_desde := greatest(coalesce(p_fecha_desde, current_date), current_date);
  v_fecha_hasta := p_fecha_hasta;

  /*
    horario_fijo_usuario is the desired weekly template.
    reservas is the real calendar occupancy.

    First clean every future fixed reservation that no longer matches the
    user's current fixed schedules. We mark these cancellations as sync-made so
    they can be safely restored if the template later changes back.
  */
  update reservas r
  set
    estado = 'cancelada',
    cancelada_en = now(),
    cancelada_correctamente = true,
    cancelada_por_sync = true
  from sesiones s
  where s.id = r.sesion_id
    and r.estado = 'activa'
    and r.es_desde_horario_fijo = true
    and coalesce(r.es_recuperacion, false) = false
    and s.fecha >= v_fecha_desde
    and (v_fecha_hasta is null or s.fecha <= v_fecha_hasta)
    and not exists (
      select 1
      from horario_fijo_usuario hfu
      join horarios_disponibles hd
        on hd.id = hfu.horario_disponible_id
      where hfu.usuario_id = r.usuario_id
        and hfu.activo = true
        and hd.activo = true
        and hd.modalidad = s.modalidad
        and hd.hora = s.hora
        and hd.dia_semana = extract(isodow from s.fecha)::integer
    );

  get diagnostics v_reservas_canceladas = row_count;

  /*
    Normalize existing rows for desired fixed schedules.

    - Active manual reservations become fixed reservations.
    - Rows cancelled by a previous sync are restored automatically.
    - Other cancelled rows are restored only when the caller explicitly asks
      for it, which profile edits and month opening do.
  */
  with candidatas as (
    select distinct
      hfu.usuario_id,
      s.id as sesion_id,
      s.fecha
    from horario_fijo_usuario hfu
    join horarios_disponibles hd
      on hd.id = hfu.horario_disponible_id
    join usuarios u
      on u.id = hfu.usuario_id
    join sesiones s
      on s.modalidad = hd.modalidad
      and s.hora = hd.hora
      and extract(isodow from s.fecha)::integer = hd.dia_semana
    where hfu.activo = true
      and hd.activo = true
      and u.activo = true
      and u.rol = 'cliente'
      and s.fecha >= v_fecha_desde
      and (v_fecha_hasta is null or s.fecha <= v_fecha_hasta)
      and coalesce(s.cancelada, false) = false
      and (p_usuario_id is null or hfu.usuario_id = p_usuario_id)
  ),
  actualizables as (
    select
      r.id,
      r.estado as estado_anterior
    from reservas r
    join candidatas c
      on c.sesion_id = r.sesion_id
      and c.usuario_id = r.usuario_id
    where coalesce(r.es_recuperacion, false) = false
      and (
        r.estado = 'activa'
        or (
          not exists (
            select 1
            from festivos f
            where f.fecha = c.fecha
          )
          and (
            p_reactivar_canceladas
            or coalesce(r.cancelada_por_sync, false)
          )
        )
      )
      and (
        r.estado <> 'activa'
        or coalesce(r.es_desde_horario_fijo, false) = false
        or r.cancelada_en is not null
        or coalesce(r.cancelada_correctamente, false) <> false
        or coalesce(r.cancelada_por_sync, false) <> false
      )
  ),
  actualizadas as (
    update reservas r
    set
      estado = 'activa',
      es_recuperacion = false,
      es_desde_horario_fijo = true,
      cancelada_en = null,
      cancelada_correctamente = false,
      cancelada_por_sync = false
    from actualizables a
    where r.id = a.id
    returning a.estado_anterior
  )
  select
    count(*) filter (where estado_anterior <> 'activa')::integer,
    count(*) filter (where estado_anterior = 'activa')::integer
  into v_reservas_reactivadas, v_reservas_normalizadas
  from actualizadas;

  /*
    Create fixed reservations where there is no row at all for the user/session.
    Existing cancelled rows are intentionally handled in the normalization step.
  */
  with candidatas as (
    select distinct
      hfu.usuario_id,
      s.id as sesion_id
    from horario_fijo_usuario hfu
    join horarios_disponibles hd
      on hd.id = hfu.horario_disponible_id
    join usuarios u
      on u.id = hfu.usuario_id
    join sesiones s
      on s.modalidad = hd.modalidad
      and s.hora = hd.hora
      and extract(isodow from s.fecha)::integer = hd.dia_semana
    where hfu.activo = true
      and hd.activo = true
      and u.activo = true
      and u.rol = 'cliente'
      and s.fecha >= v_fecha_desde
      and (v_fecha_hasta is null or s.fecha <= v_fecha_hasta)
      and coalesce(s.cancelada, false) = false
      and (p_usuario_id is null or hfu.usuario_id = p_usuario_id)
      and not exists (
        select 1
        from reservas r
        where r.sesion_id = s.id
          and r.usuario_id = hfu.usuario_id
      )
  ),
  insertadas as (
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
      sesion_id,
      usuario_id,
      'activa',
      false,
      true,
      null,
      false,
      false
    from candidatas
    on conflict (sesion_id, usuario_id) do nothing
    returning 1
  )
  select count(*)::integer
  into v_reservas_insertadas
  from insertadas;

  v_reservas_creadas := v_reservas_insertadas + v_reservas_reactivadas;

  /*
    Remaining conflicts should only be technical insert failures for candidates
    that still have no reservation row after the insert attempt.
  */
  with candidatas as (
    select distinct
      hfu.usuario_id,
      s.id as sesion_id,
      s.fecha,
      s.hora,
      s.modalidad,
      u.nombre,
      u.telefono
    from horario_fijo_usuario hfu
    join horarios_disponibles hd
      on hd.id = hfu.horario_disponible_id
    join usuarios u
      on u.id = hfu.usuario_id
    join sesiones s
      on s.modalidad = hd.modalidad
      and s.hora = hd.hora
      and extract(isodow from s.fecha)::integer = hd.dia_semana
    where hfu.activo = true
      and hd.activo = true
      and u.activo = true
      and u.rol = 'cliente'
      and s.fecha >= v_fecha_desde
      and (v_fecha_hasta is null or s.fecha <= v_fecha_hasta)
      and coalesce(s.cancelada, false) = false
      and (p_usuario_id is null or hfu.usuario_id = p_usuario_id)
      and not exists (
        select 1
        from reservas r
        where r.sesion_id = s.id
          and r.usuario_id = hfu.usuario_id
      )
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'usuario_id', usuario_id,
        'nombre', nombre,
        'telefono', telefono,
        'sesion_id', sesion_id,
        'fecha', fecha,
        'hora', hora,
        'modalidad', modalidad
      )
      order by fecha, hora, nombre
    ),
    '[]'::jsonb
  )
  into v_conflictos
  from candidatas;

  return query
  select
    jsonb_array_length(v_conflictos) = 0 as ok,
    v_reservas_canceladas,
    v_reservas_creadas,
    v_conflictos,
    case
      when jsonb_array_length(v_conflictos) = 0 then
        format(
          'Reservas sincronizadas: %s canceladas, %s creadas, %s reactivadas y %s actualizadas.',
          v_reservas_canceladas,
          v_reservas_insertadas,
          v_reservas_reactivadas,
          v_reservas_normalizadas
        )
      else
        format(
          'Reservas sincronizadas parcialmente: %s canceladas, %s creadas, %s reactivadas, %s actualizadas y %s conflictos tecnicos.',
          v_reservas_canceladas,
          v_reservas_insertadas,
          v_reservas_reactivadas,
          v_reservas_normalizadas,
          jsonb_array_length(v_conflictos)
        )
    end as mensaje;
end;
$$;

grant execute on function public.regenerar_reservas_futuras(uuid, boolean, date, date) to anon;
grant execute on function public.regenerar_reservas_futuras(uuid, boolean, date, date) to authenticated;
