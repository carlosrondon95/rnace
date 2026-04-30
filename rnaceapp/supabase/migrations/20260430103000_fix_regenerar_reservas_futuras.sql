drop function if exists public.regenerar_reservas_futuras(uuid);
drop function if exists public.regenerar_reservas_futuras();

create or replace function public.regenerar_reservas_futuras(p_usuario_id uuid default null)
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
  v_reservas_creadas integer := 0;
  v_conflictos jsonb := '[]'::jsonb;
begin
  /*
    horario_fijo_usuario is the desired weekly template.
    reservas is the real calendar occupancy.

    First clean every future fixed reservation that no longer matches the
    user's current fixed schedules. This is global even when p_usuario_id is
    provided, because a stale reservation from another user can block a valid
    new fixed reservation for the edited user.
  */
  update reservas r
  set
    estado = 'cancelada',
    cancelada_en = now(),
    cancelada_correctamente = true
  from sesiones s
  where s.id = r.sesion_id
    and r.estado = 'activa'
    and r.es_desde_horario_fijo = true
    and coalesce(r.es_recuperacion, false) = false
    and s.fecha >= current_date
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
    Create missing fixed reservations for the requested user, or for all users
    when p_usuario_id is null.

    Capacity is intentionally not enforced here. Admins can decide to overbook
    a fixed class for special cases, so the source of truth must be "this user
    has this fixed schedule" and not "this session still has free public slots".
  */
  with candidatas as (
    select distinct
      hfu.usuario_id,
      s.id as sesion_id,
      s.fecha,
      s.hora,
      s.modalidad,
      s.capacidad,
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
      and s.fecha >= current_date
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
      cancelada_correctamente
    )
    select
      sesion_id,
      usuario_id,
      'activa',
      false,
      true,
      null,
      false
    from candidatas
    on conflict (sesion_id, usuario_id) do nothing
    returning 1
  )
  select count(*)::integer
  into v_reservas_creadas
  from insertadas;

  /*
    Anything still missing after the insert is a technical conflict, normally a
    duplicate/cancelled reservation row already present for the same
    session/user. It is not an aforo conflict.
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
      and s.fecha >= current_date
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
          'Reservas sincronizadas: %s canceladas y %s creadas.',
          v_reservas_canceladas,
          v_reservas_creadas
        )
      else
        format(
          'Reservas sincronizadas parcialmente: %s canceladas, %s creadas y %s conflictos técnicos.',
          v_reservas_canceladas,
          v_reservas_creadas,
          jsonb_array_length(v_conflictos)
        )
    end as mensaje;
end;
$$;

grant execute on function public.regenerar_reservas_futuras(uuid) to anon;
grant execute on function public.regenerar_reservas_futuras(uuid) to authenticated;
