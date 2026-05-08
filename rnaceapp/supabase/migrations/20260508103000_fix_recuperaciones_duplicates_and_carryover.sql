-- Fix recuperaciones duplicadas y arrastre de mes anterior.
--
-- Problemas detectados:
-- 1. Se podian generar dos recuperaciones disponibles para la misma reserva
--    cancelada. Ejemplos reales: sesion_cancelada_id 754 y 755.
-- 2. Antes de usar una recuperacion de mes anterior, la RPC mostraba todas
--    las recuperaciones arrastrables. Despues de usar una, las demas dejaban
--    de verse por la logica de shrink, dando la sensacion de que se habian
--    eliminado dos al usar una.
-- 3. usar_recuperacion serializaba por usuario+sesion destino. Dos consumos
--    simultaneos del mismo usuario en sesiones distintas podian saltarse la
--    regla de una recuperacion arrastrada.

-- 1. Caducar duplicados activos para poder crear el indice unico.
--    Conservamos una sola fila por reserva cancelada. Si ya hubo consumos
--    duplicados historicos, mantenemos la usada mas antigua y caducamos el
--    resto para no permitir que esa misma cancelacion genere mas credito.
with ranked as (
  select
    r.id,
    r.estado,
    row_number() over (
      partition by r.usuario_id, r.sesion_cancelada_id
      order by
        case r.estado
          when 'usada' then 0
          when 'disponible' then 1
          else 2
        end,
        r.id
    ) as rn
  from recuperaciones r
  where r.sesion_cancelada_id is not null
    and r.estado in ('disponible', 'usada')
)
update recuperaciones r
set estado = 'caducada'
from ranked d
where d.id = r.id
  and d.rn > 1;

-- 2. Evitar que vuelva a haber mas de una recuperacion activa/usada para la
--    misma sesion cancelada.
create unique index if not exists recuperaciones_unique_active_cancelled_session
  on recuperaciones (usuario_id, sesion_cancelada_id)
  where sesion_cancelada_id is not null
    and estado in ('disponible', 'usada');

-- 3. Listado oficial de recuperaciones.
--    Si una recuperacion se puede arrastrar al mes siguiente, solo la primera
--    del usuario para ese mes limite mantiene ese mes limite extendido. El
--    resto queda limitada a su mes de origen a efectos de visualizacion/uso.
create or replace function public.obtener_recuperaciones_usuario(p_usuario_id uuid)
returns table(id bigint, modalidad text, mes_limite integer, anio_limite integer, mes_origen integer, anio_origen integer)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_mes_actual integer := extract(month from current_date)::integer;
  v_anio_actual integer := extract(year from current_date)::integer;
begin
  return query
  with base as (
    select
      r.id,
      r.usuario_id,
      r.modalidad,
      r.mes_limite,
      r.anio_limite,
      r.mes_origen,
      r.anio_origen,
      (
        r.mes_limite <> r.mes_origen
        or r.anio_limite <> r.anio_origen
      ) as es_arrastrable,
      exists (
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
      ) as ya_uso_arrastre,
      row_number() over (
        partition by r.usuario_id, r.anio_limite, r.mes_limite
        order by r.anio_origen asc, r.mes_origen asc, r.id asc
      ) as orden_arrastre
    from recuperaciones r
    where r.usuario_id = p_usuario_id
      and r.estado = 'disponible'
  ),
  computed as (
    select
      b.id,
      b.modalidad,
      case
        when b.es_arrastrable
          and (b.ya_uso_arrastre or b.orden_arrastre > 1)
        then b.mes_origen
        else b.mes_limite
      end as v_mes_limite,
      case
        when b.es_arrastrable
          and (b.ya_uso_arrastre or b.orden_arrastre > 1)
        then b.anio_origen
        else b.anio_limite
      end as v_anio_limite,
      b.mes_origen,
      b.anio_origen
    from base b
  )
  select
    computed.id,
    computed.modalidad,
    computed.v_mes_limite,
    computed.v_anio_limite,
    computed.mes_origen,
    computed.anio_origen
  from computed
  where computed.v_anio_limite > v_anio_actual
     or (computed.v_anio_limite = v_anio_actual and computed.v_mes_limite >= v_mes_actual)
  order by computed.v_anio_limite asc, computed.v_mes_limite asc, computed.id asc;
end;
$function$;

grant execute on function public.obtener_recuperaciones_usuario(uuid) to anon;
grant execute on function public.obtener_recuperaciones_usuario(uuid) to authenticated;

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
    Serialize all recovery consumptions for the same user. The carry-over rule
    depends on previous uses in the target month, so different target sessions
    for the same user must not run in parallel.
  */
  perform pg_advisory_xact_lock(
    hashtextextended('usar_recuperacion:' || p_usuario_id::text, 0)
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
      (
        r.mes_limite <> r.mes_origen
        or r.anio_limite <> r.anio_origen
      ) as es_arrastrable,
      exists (
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
      ) as ya_uso_arrastre,
      (
        select count(*) + 1
        from recuperaciones previa
        where previa.usuario_id = r.usuario_id
          and previa.estado = 'disponible'
          and previa.anio_limite = r.anio_limite
          and previa.mes_limite = r.mes_limite
          and (
            previa.anio_origen < r.anio_origen
            or (previa.anio_origen = r.anio_origen and previa.mes_origen < r.mes_origen)
            or (
              previa.anio_origen = r.anio_origen
              and previa.mes_origen = r.mes_origen
              and previa.id < r.id
            )
          )
      ) as orden_arrastre
  ) reglas
  cross join lateral (
    select
      case
        when reglas.es_arrastrable
          and (reglas.ya_uso_arrastre or reglas.orden_arrastre > 1)
        then r.mes_origen
        else r.mes_limite
      end as mes_limite_efectivo,
      case
        when reglas.es_arrastrable
          and (reglas.ya_uso_arrastre or reglas.orden_arrastre > 1)
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
