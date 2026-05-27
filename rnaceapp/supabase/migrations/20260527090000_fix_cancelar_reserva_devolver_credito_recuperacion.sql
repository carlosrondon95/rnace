-- Fix: cancelar una reserva creada usando una recuperacion debe devolver el
-- credito, no intentar crear otra fila en recuperaciones.
--
-- Caso reproducido: usuario cancela su clase fija (genera recup A, estado
-- 'disponible', sesion_cancelada_id = X), inmediatamente usa A para volver a
-- reservar la misma sesion (recup A -> 'usada', sesion_uso_id = X, reserva
-- reactivada con es_recuperacion = true) y luego cancela otra vez con margen
-- suficiente. La logica previa intentaba insertar una nueva fila en
-- recuperaciones con sesion_cancelada_id = X, pero el indice unico parcial
-- recuperaciones_unique_active_cancelled_session sobre
-- (usuario_id, sesion_cancelada_id) where estado in ('disponible','usada')
-- disparaba el ON CONFLICT DO NOTHING y el usuario se quedaba sin credito.
--
-- Solucion: si la reserva cancelada tenia es_recuperacion = true, revertimos
-- la recuperacion que se habia usado para esa sesion ('usada' -> 'disponible'
-- y limpiamos fecha_uso/sesion_uso_id/mes_uso/anio_uso). Si por algun motivo
-- no encontramos la fila a revertir (datos inconsistentes), caemos al INSERT
-- como antes para no dejar al usuario sin credito.

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
  v_es_recuperacion boolean;
  v_mes_origen integer;
  v_anio_origen integer;
  v_mes_limite integer;
  v_anio_limite integer;
  v_ahora timestamptz := now();
  v_inicio_sesion timestamptz;
  v_generar_recuperacion boolean := false;
  v_usuarios_notificados uuid[] := '{}';
  v_recup_revertidas integer := 0;
begin
  select r.sesion_id, r.estado, r.es_recuperacion, s.fecha, s.hora, s.modalidad
  into v_sesion_id, v_estado_reserva, v_es_recuperacion, v_fecha, v_hora, v_modalidad
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

  v_generar_recuperacion :=
    p_generar_recuperacion
    and v_inicio_sesion >= (v_ahora + interval '1 hour');

  update reservas
  set estado = 'cancelada',
      cancelada_en = v_ahora
  where id = p_reserva_id;

  if v_generar_recuperacion then
    if v_es_recuperacion then
      update recuperaciones
      set
        estado = 'disponible',
        fecha_uso = null,
        sesion_uso_id = null,
        mes_uso = null,
        anio_uso = null
      where usuario_id = p_usuario_id
        and sesion_uso_id = v_sesion_id
        and estado = 'usada';
      get diagnostics v_recup_revertidas = row_count;
    end if;

    if not v_es_recuperacion or v_recup_revertidas = 0 then
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
  v_es_recuperacion boolean;
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
  v_recup_revertidas integer := 0;
begin
  select r.usuario_id, r.sesion_id, r.estado, r.es_recuperacion, s.fecha, s.hora, s.modalidad
  into v_usuario_id, v_sesion_id, v_estado_reserva, v_es_recuperacion, v_fecha, v_hora, v_modalidad
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
    if v_es_recuperacion then
      update recuperaciones
      set
        estado = 'disponible',
        fecha_uso = null,
        sesion_uso_id = null,
        mes_uso = null,
        anio_uso = null
      where usuario_id = v_usuario_id
        and sesion_uso_id = v_sesion_id
        and estado = 'usada';
      get diagnostics v_recup_revertidas = row_count;
    end if;

    if not v_es_recuperacion or v_recup_revertidas = 0 then
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
