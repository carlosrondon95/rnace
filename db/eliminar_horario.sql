-- RPC para ELIMINAR un horario semanal (plantilla) desde el panel de admin.
-- Ejecutar UNA VEZ en el SQL Editor de Supabase.
--
-- Por qué existe: el borrado desde el front hacía 5 peticiones HTTP sueltas
-- (cancelar reservas → cancelar sesiones → limpiar lista de espera → borrar el
-- horario) y la última fallaba SIEMPRE con violación de clave ajena, porque
-- horario_fijo_usuario.horario_disponible_id referencia horarios_disponibles y
-- nadie limpiaba esas filas. Las 4 primeras peticiones commiteaban y el horario
-- nunca se borraba: cada intento dejaba sesiones y reservas canceladas a medias,
-- sin recuperación y sin turno borrado. Aquí todo ocurre en UNA transacción: o
-- se borra todo, o no se toca nada.
--
-- Con p_dry_run = true no escribe nada y devuelve solo el impacto. Es lo que el
-- front usa para construir el diálogo de confirmación, así lo que se avisa y lo
-- que se ejecuta salen de la misma consulta.
--
-- El emparejamiento horario → sesiones usa la misma lógica
-- (modalidad + hora + dia_semana = isodow(fecha)) que regenerar_reservas_futuras
-- y reactivar_usuario, para no divergir. No puede solaparse con otro horario
-- porque (dia_semana, hora, modalidad) es único en horarios_disponibles.
--
-- Por qué NO se reutiliza cancelar_reserva_admin para las recuperaciones, que
-- sería lo natural: ese RPC (a) inserta SIEMPRE una fila en notificaciones
-- (p_titulo_notif = null solo cambia el texto por uno genérico, no evita el
-- aviso) y (b) llama a notificar_hueco_disponible, que avisa de una plaza libre
-- en una clase que justo estamos borrando. El borrado de un turno debe ser
-- silencioso, así que se replica aquí SOLO el bloque de recuperación de ese RPC
-- (mes_origen/mes_limite, salto de diciembre y el on conflict parcial). Si algún
-- día cambia la regla del mes límite, hay que tocar los dos sitios.
--
-- Dos matices sobre los créditos de recuperación:
--   * Si la reserva se hizo GASTANDO una recuperación, se devuelve el crédito
--     (igual que desactivar_usuario) aunque el admin elija "sin recuperaciones":
--     una cosa es no regalar crédito nuevo y otra quedarse el que ya tenía.
--   * Solo se genera recuperación nueva si la clase aún no ha empezado, con el
--     mismo criterio de zona horaria que cancelar_reserva_admin
--     ((fecha + hora) at time zone 'Europe/Madrid').
--
-- Es SECURITY DEFINER para no depender de la RLS sobre reservas/sesiones.

-- La primera versión de este RPC no tenía p_generar_recuperaciones. Como añadir
-- un parámetro crea una sobrecarga en vez de reemplazar la función, hay que
-- tirar la firma antigua o las llamadas quedarían ambiguas.
drop function if exists public.eliminar_horario(integer, boolean);

create or replace function public.eliminar_horario(
  p_horario_id integer,
  p_generar_recuperaciones boolean default false,
  p_dry_run boolean default false
)
returns table (
  ok boolean,
  horario jsonb,
  usuarios_fijos jsonb,
  reservas_afectadas jsonb,
  sesiones_canceladas integer,
  reservas_canceladas integer,
  recuperaciones_generadas integer,
  creditos_devueltos integer,
  horarios_fijos_borrados integer,
  mensaje text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ahora timestamptz := now();
  v_hd horarios_disponibles%rowtype;
  v_horario jsonb;
  v_usuarios jsonb := '[]'::jsonb;
  v_reservas jsonb := '[]'::jsonb;
  v_sesion_ids bigint[] := '{}';
  v_num_sesiones integer := 0;
  v_num_reservas integer := 0;
  v_num_hfu integer := 0;
  v_num_recups integer := 0;
  v_num_creditos integer := 0;
begin
  -- 1. Bloquear el horario para que no cambie mientras calculamos el impacto.
  select * into v_hd
  from horarios_disponibles
  where id = p_horario_id
  for update;

  if not found then
    return query
    select false, null::jsonb, '[]'::jsonb, '[]'::jsonb, 0, 0, 0, 0, 0,
           format('El horario %s ya no existe.', p_horario_id)::text;
    return;
  end if;

  v_horario := jsonb_build_object(
    'id', v_hd.id,
    'dia_semana', v_hd.dia_semana,
    'hora', substring(v_hd.hora::text from 1 for 5),
    'modalidad', v_hd.modalidad,
    'capacidad_maxima', v_hd.capacidad_maxima,
    'activo', v_hd.activo
  );

  -- 2. Sesiones futuras de este turno que siguen vivas.
  select coalesce(array_agg(s.id), '{}'::bigint[])
  into v_sesion_ids
  from sesiones s
  where s.modalidad = v_hd.modalidad
    and s.hora = v_hd.hora
    and extract(isodow from s.fecha)::integer = v_hd.dia_semana
    and s.fecha >= current_date
    and coalesce(s.cancelada, false) = false;

  v_num_sesiones := coalesce(cardinality(v_sesion_ids), 0);

  -- 3. Alumnos que tienen este turno como horario fijo: son las filas que
  --    bloquean el borrado y las que hay que limpiar.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'horario_fijo_id', hfu.id,
               'usuario_id', hfu.usuario_id,
               'nombre', coalesce(u.nombre, '(usuario borrado)'),
               'activo', hfu.activo
             )
             order by coalesce(u.nombre, '')
           ),
           '[]'::jsonb
         )
  into v_usuarios
  from horario_fijo_usuario hfu
  left join usuarios u on u.id = hfu.usuario_id
  where hfu.horario_disponible_id = p_horario_id;

  -- 4. Reservas activas sobre esas sesiones futuras (las que perderán la clase).
  --    es_futura marca las que pueden generar recuperación.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'reserva_id', r.id,
               'usuario_id', r.usuario_id,
               'nombre', coalesce(u.nombre, '(usuario borrado)'),
               'sesion_id', r.sesion_id,
               'fecha', s.fecha,
               'hora', substring(s.hora::text from 1 for 5),
               'es_recuperacion', coalesce(r.es_recuperacion, false),
               'es_futura', (s.fecha + s.hora) at time zone 'Europe/Madrid' > v_ahora
             )
             order by s.fecha
           ),
           '[]'::jsonb
         ),
         count(*)::integer
  into v_reservas, v_num_reservas
  from reservas r
  join sesiones s on s.id = r.sesion_id
  left join usuarios u on u.id = r.usuario_id
  where r.sesion_id = any(v_sesion_ids)
    and r.estado = 'activa';

  -- 5. Dry run: devolver el impacto sin tocar nada.
  if p_dry_run then
    return query
    select true, v_horario, v_usuarios, v_reservas,
           v_num_sesiones, v_num_reservas, 0, 0,
           jsonb_array_length(v_usuarios),
           format(
             'Simulación: se cancelarían %s sesiones futuras y %s reservas, y se quitaría el turno a %s alumnos.',
             v_num_sesiones, v_num_reservas, jsonb_array_length(v_usuarios)
           )::text;
    return;
  end if;

  -- 6a. Recuperación nueva por cada clase futura que se pierde, si el admin lo
  --     pidió. Va ANTES de 6b porque el criterio "esta reserva ya gastó una
  --     recuperación" se comprueba contra la fila 'usada', que 6b anula.
  --     Bloque calcado de cancelar_reserva_admin.
  if p_generar_recuperaciones then
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
    select
      r.usuario_id,
      s.id,
      s.modalidad,
      extract(month from s.fecha)::integer,
      extract(year from s.fecha)::integer,
      case when extract(month from s.fecha)::integer = 12
           then 1
           else extract(month from s.fecha)::integer + 1 end,
      case when extract(month from s.fecha)::integer = 12
           then extract(year from s.fecha)::integer + 1
           else extract(year from s.fecha)::integer end,
      'disponible'
    from reservas r
    join sesiones s on s.id = r.sesion_id
    where r.sesion_id = any(v_sesion_ids)
      and r.estado = 'activa'
      and (s.fecha + s.hora) at time zone 'Europe/Madrid' > v_ahora
      -- Si la reserva se hizo gastando una recuperación, no se crea crédito
      -- nuevo: se le devuelve el suyo en 6b.
      and not exists (
        select 1
        from recuperaciones rec
        where rec.usuario_id = r.usuario_id
          and rec.sesion_uso_id = r.sesion_id
          and rec.estado = 'usada'
      )
    on conflict (usuario_id, sesion_cancelada_id)
      where sesion_cancelada_id is not null
        and estado in ('disponible', 'usada')
    do nothing;
    get diagnostics v_num_recups = row_count;
  end if;

  -- 6b. Devolver el crédito de las reservas futuras hechas CON recuperación.
  --     Se hace siempre, elija el admin generar recuperaciones o no.
  update recuperaciones rec
  set estado = 'disponible',
      fecha_uso = null,
      sesion_uso_id = null,
      mes_uso = null,
      anio_uso = null
  where rec.estado = 'usada'
    and exists (
      select 1
      from reservas r
      where r.sesion_id = any(v_sesion_ids)
        and r.estado = 'activa'
        and r.usuario_id = rec.usuario_id
        and r.sesion_id = rec.sesion_uso_id
    );
  get diagnostics v_num_creditos = row_count;

  -- 6c. Cancelar (soft) las reservas activas que queden. Se filtra por sesión y
  --     no por la lista de ids del punto 4 para barrer también lo que haya
  --     entrado entremedias.
  update reservas r
  set estado = 'cancelada',
      cancelada_en = v_ahora,
      cancelada_correctamente = true
  where r.sesion_id = any(v_sesion_ids)
    and r.estado = 'activa';
  get diagnostics v_num_reservas = row_count;

  -- 6d. Marcar las sesiones futuras como canceladas (toda la app filtra por
  --     cancelada = false). No se borran: conservan su histórico de reservas.
  update sesiones
  set cancelada = true,
      motivo_cancelacion = 'Horario eliminado'
  where id = any(v_sesion_ids);
  get diagnostics v_num_sesiones = row_count;

  -- 6e. Vaciar la lista de espera de esas sesiones: ya no habrá hueco que dar.
  delete from lista_espera
  where sesion_id = any(v_sesion_ids);

  -- 6f. Quitar el turno del horario base de los alumnos. ESTA es la pieza que
  --     faltaba: sin ella la FK horario_fijo_usuario → horarios_disponibles
  --     impide el borrado del punto 6g.
  delete from horario_fijo_usuario
  where horario_disponible_id = p_horario_id;
  get diagnostics v_num_hfu = row_count;

  -- 6g. Y por fin, el horario.
  delete from horarios_disponibles
  where id = p_horario_id;

  return query
  select true, v_horario, v_usuarios, v_reservas,
         v_num_sesiones, v_num_reservas, v_num_recups, v_num_creditos, v_num_hfu,
         format(
           'Horario eliminado. %s sesiones futuras canceladas, %s reservas canceladas y %s alumnos se quedan sin este turno fijo%s%s.',
           v_num_sesiones,
           v_num_reservas,
           v_num_hfu,
           case when v_num_recups > 0
                then format('. %s recuperaciones generadas', v_num_recups)
                else '' end,
           case when v_num_creditos > 0
                then format('. %s créditos de recuperación devueltos', v_num_creditos)
                else '' end
         )::text;
end;
$$;

grant execute on function public.eliminar_horario(integer, boolean, boolean) to anon;
grant execute on function public.eliminar_horario(integer, boolean, boolean) to authenticated;
