-- Fix: las RPC de cancelacion no deben generar recuperaciones retroactivas.
--
-- Las sesiones guardan fecha/hora como horario local del centro. En Supabase
-- now() esta en UTC, asi que comparamos el inicio real usando Europe/Madrid.
-- Esto evita casos como 01/05 10:00 Madrid, donde a las 08:49 UTC la clase ya
-- habia empezado aunque una comparacion ingenua contra 10:00 UTC diga que no.

drop function if exists public.cancelar_reserva(uuid, bigint, boolean);

create or replace function public.cancelar_reserva(
  p_usuario_id uuid,
  p_reserva_id bigint,
  p_generar_recuperacion boolean default true
)
returns table (
  ok boolean,
  mensaje text,
  usuarios_notificados uuid[]
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_sesion_id bigint;
  v_fecha date;
  v_hora time;
  v_modalidad text;
  v_estado_reserva text;
  v_mes_origen integer;
  v_anio_origen integer;
  v_mes_limite integer;
  v_anio_limite integer;
  v_ahora timestamptz := now();
  v_inicio_sesion timestamptz;
  v_generar_recuperacion boolean := false;
  v_usuarios_notificados uuid[] := '{}';
begin
  select r.sesion_id, r.estado, s.fecha, s.hora, s.modalidad
  into v_sesion_id, v_estado_reserva, v_fecha, v_hora, v_modalidad
  from reservas r
  join sesiones s on s.id = r.sesion_id
  where r.id = p_reserva_id
    and r.usuario_id = p_usuario_id;

  if v_sesion_id is null then
    return query select false, 'Reserva no encontrada.'::text, '{}'::uuid[];
    return;
  end if;

  if v_estado_reserva <> 'activa' then
    return query select false, 'La reserva no esta activa.'::text, '{}'::uuid[];
    return;
  end if;

  v_inicio_sesion := (v_fecha + v_hora) at time zone 'Europe/Madrid';

  /*
    Cliente: mantenemos la regla de la app: solo hay recuperacion si cancela
    con al menos 1 hora de margen. Esto tambien evita llamadas directas a la
    RPC intentando forzar p_generar_recuperacion=true.
  */
  v_generar_recuperacion :=
    p_generar_recuperacion
    and v_inicio_sesion >= (v_ahora + interval '1 hour');

  update reservas
  set estado = 'cancelada',
      cancelada_en = v_ahora
  where id = p_reserva_id;

  if v_generar_recuperacion then
    v_mes_origen := extract(month from v_fecha)::integer;
    v_anio_origen := extract(year from v_fecha)::integer;

    if v_mes_origen = 12 then
      v_mes_limite := 1;
      v_anio_limite := v_anio_origen + 1;
    else
      v_mes_limite := v_mes_origen + 1;
      v_anio_limite := v_anio_origen;
    end if;

    insert into recuperaciones (
      usuario_id,
      sesion_cancelada_id,
      modalidad,
      mes_origen,
      anio_origen,
      mes_limite,
      anio_limite,
      estado
    )
    values (
      p_usuario_id,
      v_sesion_id,
      v_modalidad,
      v_mes_origen,
      v_anio_origen,
      v_mes_limite,
      v_anio_limite,
      'disponible'
    )
    on conflict (usuario_id, sesion_cancelada_id)
      where sesion_cancelada_id is not null
        and estado in ('disponible', 'usada')
    do nothing;
  end if;

  v_usuarios_notificados := notificar_hueco_disponible(v_sesion_id);

  if v_generar_recuperacion then
    return query select true, 'Clase cancelada. Se ha generado una recuperacion.'::text, v_usuarios_notificados;
  elsif p_generar_recuperacion and v_inicio_sesion < (v_ahora + interval '1 hour') then
    return query select true, 'Clase cancelada correctamente. No se ha generado recuperacion porque la clase empezaba en menos de 1 hora.'::text, v_usuarios_notificados;
  else
    return query select true, 'Clase cancelada correctamente.'::text, v_usuarios_notificados;
  end if;
end;
$function$;

grant execute on function public.cancelar_reserva(uuid, bigint, boolean) to anon;
grant execute on function public.cancelar_reserva(uuid, bigint, boolean) to authenticated;

drop function if exists public.cancelar_reserva_admin(bigint, boolean, text, text);

create or replace function public.cancelar_reserva_admin(
  p_reserva_id bigint,
  p_generar_recuperacion boolean,
  p_titulo_notif text default null,
  p_mensaje_notif text default null
)
returns table (
  ok boolean,
  mensaje text,
  usuarios_notificados uuid[]
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_usuario_id uuid;
  v_sesion_id bigint;
  v_fecha date;
  v_hora time;
  v_modalidad text;
  v_estado_reserva text;
  v_mes_origen integer;
  v_anio_origen integer;
  v_mes_limite integer;
  v_anio_limite integer;
  v_ahora timestamptz := now();
  v_inicio_sesion timestamptz;
  v_generar_recuperacion boolean := false;
  v_usuarios_notificados uuid[] := '{}';
  v_titulo_final text;
  v_mensaje_final text;
begin
  select r.usuario_id, r.sesion_id, r.estado, s.fecha, s.hora, s.modalidad
  into v_usuario_id, v_sesion_id, v_estado_reserva, v_fecha, v_hora, v_modalidad
  from reservas r
  join sesiones s on s.id = r.sesion_id
  where r.id = p_reserva_id;

  if v_sesion_id is null then
    return query select false, 'Reserva no encontrada.'::text, '{}'::uuid[];
    return;
  end if;

  if v_estado_reserva <> 'activa' then
    return query select false, 'La reserva no esta activa.'::text, '{}'::uuid[];
    return;
  end if;

  v_inicio_sesion := (v_fecha + v_hora) at time zone 'Europe/Madrid';
  v_generar_recuperacion := p_generar_recuperacion and v_inicio_sesion > v_ahora;

  update reservas
  set estado = 'cancelada',
      cancelada_en = v_ahora
  where id = p_reserva_id;

  if v_generar_recuperacion then
    v_mes_origen := extract(month from v_fecha)::integer;
    v_anio_origen := extract(year from v_fecha)::integer;

    if v_mes_origen = 12 then
      v_mes_limite := 1;
      v_anio_limite := v_anio_origen + 1;
    else
      v_mes_limite := v_mes_origen + 1;
      v_anio_limite := v_anio_origen;
    end if;

    insert into recuperaciones (
      usuario_id,
      sesion_cancelada_id,
      modalidad,
      mes_origen,
      anio_origen,
      mes_limite,
      anio_limite,
      estado
    )
    values (
      v_usuario_id,
      v_sesion_id,
      v_modalidad,
      v_mes_origen,
      v_anio_origen,
      v_mes_limite,
      v_anio_limite,
      'disponible'
    )
    on conflict (usuario_id, sesion_cancelada_id)
      where sesion_cancelada_id is not null
        and estado in ('disponible', 'usada')
    do nothing;
  end if;

  v_titulo_final := coalesce(p_titulo_notif, 'Reserva cancelada');
  v_mensaje_final := coalesce(
    p_mensaje_notif,
    format(
      'Tu clase del %s a las %s ha sido eliminada por el administrador.',
      to_char(v_fecha, 'DD/MM/YYYY'),
      to_char(v_hora, 'HH24:MI')
    )
  );

  insert into notificaciones (usuario_id, tipo, titulo, mensaje, sesion_id, leida, creado_en)
  values (
    v_usuario_id,
    'cancelacion',
    v_titulo_final,
    v_mensaje_final,
    v_sesion_id,
    false,
    v_ahora
  );

  v_usuarios_notificados := notificar_hueco_disponible(v_sesion_id);

  if v_generar_recuperacion then
    return query select true, 'Clase cancelada por el administrador. Se ha generado una recuperacion.'::text, v_usuarios_notificados;
  elsif p_generar_recuperacion and v_inicio_sesion <= v_ahora then
    return query select true, 'Clase cancelada por el administrador correctamente. No se ha generado recuperacion porque la clase ya habia empezado.'::text, v_usuarios_notificados;
  else
    return query select true, 'Clase cancelada por el administrador correctamente.'::text, v_usuarios_notificados;
  end if;
end;
$function$;

grant execute on function public.cancelar_reserva_admin(bigint, boolean, text, text) to anon;
grant execute on function public.cancelar_reserva_admin(bigint, boolean, text, text) to authenticated;
