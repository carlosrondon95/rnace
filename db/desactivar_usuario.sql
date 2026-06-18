-- RPC para DESACTIVAR un usuario liberando sus plazas futuras.
-- Ejecutar UNA VEZ en el SQL Editor de Supabase.
--
-- Al marcar un usuario como inactivo (usuarios.activo = false) hay que:
--   1. Marcarlo inactivo (deja de poder iniciar sesión: el login filtra activo=true).
--   2. Devolver el crédito de las reservas hechas con recuperación (para no
--      perderlo al "congelar" al usuario).
--   3. Cancelar (soft) TODAS sus reservas futuras activas → libera la plaza en la
--      agenda/calendario (la ocupación cuenta sólo reservas con estado='activa').
--   4. Sacarlo de las listas de espera futuras.
--   5. Devolver, por cada hueco liberado, los usuarios en lista de espera aún no
--      avisados (marcándolos como avisados) para que el front les envíe el push
--      "hueco disponible" igual que hace cancelar_reserva_admin.
--
-- NO se marca cancelada_por_sync: estas cancelaciones quedan distinguibles y se
-- restauran al reactivar vía regenerar_reservas_futuras(uid, reactivar=true), que
-- sólo actúa sobre usuarios con activo=true (de ahí que la reactivación funcione
-- automáticamente con el sync que ya hace el panel al guardar).
--
-- Es SECURITY DEFINER para no depender de la RLS sobre usuarios/reservas.

create or replace function public.desactivar_usuario(p_usuario_id uuid)
returns table (
  ok boolean,
  reservas_liberadas integer,
  huecos jsonb,
  mensaje text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ahora timestamptz := now();
  v_reservas_liberadas integer := 0;
  v_sesion_ids bigint[] := '{}';
  v_huecos jsonb := '[]'::jsonb;
  v_sid bigint;
  v_users uuid[] := '{}';
  v_fecha date;
  v_hora text;
  v_modalidad text;
begin
  -- 1. Marcar inactivo.
  update usuarios
  set activo = false,
      actualizado_en = v_ahora
  where id = p_usuario_id;

  -- 2. Devolver crédito de las reservas futuras hechas con recuperación.
  update recuperaciones rec
  set estado = 'disponible',
      fecha_uso = null,
      sesion_uso_id = null,
      mes_uso = null,
      anio_uso = null
  where rec.usuario_id = p_usuario_id
    and rec.estado = 'usada'
    and rec.sesion_uso_id in (
      select r.sesion_id
      from reservas r
      join sesiones s on s.id = r.sesion_id
      where r.usuario_id = p_usuario_id
        and r.estado = 'activa'
        and coalesce(r.es_recuperacion, false) = true
        and s.fecha >= current_date
    );

  -- 3. Cancelar (soft) todas sus reservas futuras activas → libera plazas.
  with canceladas as (
    update reservas r
    set estado = 'cancelada',
        cancelada_en = v_ahora,
        cancelada_correctamente = true
    from sesiones s
    where s.id = r.sesion_id
      and r.usuario_id = p_usuario_id
      and r.estado = 'activa'
      and s.fecha >= current_date
    returning r.sesion_id
  )
  select count(*)::integer, coalesce(array_agg(distinct sesion_id), '{}'::bigint[])
  into v_reservas_liberadas, v_sesion_ids
  from canceladas;

  -- 4. Sacarlo de las listas de espera futuras.
  delete from lista_espera le
  using sesiones s
  where s.id = le.sesion_id
    and le.usuario_id = p_usuario_id
    and s.fecha >= current_date;

  -- 5. Recolectar la lista de espera de cada hueco liberado y marcarla avisada.
  if array_length(v_sesion_ids, 1) is not null then
    foreach v_sid in array v_sesion_ids loop
      -- Usuarios en espera de esta sesión aún no avisados.
      select coalesce(array_agg(le.usuario_id order by le.creado_en), '{}'::uuid[])
      into v_users
      from lista_espera le
      where le.sesion_id = v_sid
        and le.notificado is not true;

      -- Marcarlos como avisados para no repetir el aviso más adelante.
      if array_length(v_users, 1) is not null then
        update lista_espera
        set notificado = true,
            notificado_en = v_ahora
        where sesion_id = v_sid
          and notificado is not true;
      end if;

      select s.fecha, s.hora::text, s.modalidad
      into v_fecha, v_hora, v_modalidad
      from sesiones s
      where s.id = v_sid;

      v_huecos := v_huecos || jsonb_build_object(
        'sesion_id', v_sid,
        'fecha', v_fecha,
        'hora', substring(v_hora from 1 for 5),
        'modalidad', v_modalidad,
        'usuarios', to_jsonb(v_users)
      );
    end loop;
  end if;

  return query
  select
    true,
    v_reservas_liberadas,
    v_huecos,
    format('Usuario desactivado. Se han liberado %s reservas futuras.', v_reservas_liberadas)::text;
end;
$$;

grant execute on function public.desactivar_usuario(uuid) to anon;
grant execute on function public.desactivar_usuario(uuid) to authenticated;
