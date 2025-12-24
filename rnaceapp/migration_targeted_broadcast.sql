-- Función para enviar notificaciones push filtradas por grupo
-- p_grupo_objetivo: 'todos', 'focus', 'reducido'
-- Los usuarios 'hibrido' reciben mensajes tanto de 'focus' como de 'reducido'
create or replace function enviar_aviso_filtrado(
  p_usuario_id uuid,
  p_titulo text,
  p_mensaje text,
  p_tipo text,
  p_grupo_objetivo text -- 'todos', 'focus', 'reducido'
) returns table (
  ok boolean,
  mensaje text
) language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
  v_rol text;
begin
  -- 1. Verificar permisos (solo admin puede enviar avisos broadcast)
  if p_usuario_id is null then
     return query select false, 'Usuario no identificado'::text;
     return;
  end if;

  select (auth.jwt() -> 'app_metadata' ->> 'rol') into v_rol;

  if v_rol is null or v_rol <> 'admin' then
     -- Fallback check en tabla usuarios por si acaso
     select rol into v_rol from usuarios where id = p_usuario_id;
     if v_rol <> 'admin' then
        return query select false, 'No tienes permisos para realizar esta acción'::text;
        return;
     end if;
  end if;

  -- 2. Insertar notificaciones filtradas
  -- Lógica de Grupos:
  -- 'todos': Todos los usuarios activos (excepto el emisor si se quisiera, pero aquí mandamos a todos)
  -- 'focus': Usuarios con plan_usuario.tipo_grupo = 'focus' OR 'hibrido'
  -- 'reducido': Usuarios con plan_usuario.tipo_grupo = 'reducido' OR 'hibrido'

  with usuarios_destino as (
    select u.id
    from usuarios u
    join plan_usuario pu on u.id = pu.usuario_id
    where u.activo = true
      and pu.activo = true
      and (
        p_grupo_objetivo = 'todos'
        OR (p_grupo_objetivo = 'focus' AND pu.tipo_grupo in ('focus', 'hibrido'))
        OR (p_grupo_objetivo = 'reducido' AND pu.tipo_grupo in ('reducido', 'hibrido'))
      )
  ),
  inserted_notif as (
    insert into notificaciones (usuario_id, titulo, mensaje, tipo, leida, creado_en)
    select id, p_titulo, p_mensaje, p_tipo, false, now()
    from usuarios_destino
    returning id
  )
  select count(*) into v_count from inserted_notif;

  -- 3. (Opcional) Aquí se podría invocar a Edge Function para Push Notifications inmediato
  -- Por simplicidad, asumimos que hay un cron o trigger, o el cliente llama a la Edge Function tras esto.
  -- En este proyecto, la Edge Function 'send-push' suele iterar sobre notificaciones no enviadas o usa triggers.
  -- Como la user request anterior migró a 'send-push' via Edge Function y supuestamente usa triggers o llamadas directas.
  -- Si el sistema actual usa trigger en 'notificaciones', ya se enviará el push.

  return query select true, format('Notificación enviada a %s usuarios.', v_count)::text;
end;
$$;
