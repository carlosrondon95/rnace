CREATE OR REPLACE FUNCTION cambiar_turno(
  p_usuario_id UUID,
  p_reserva_id BIGINT,
  p_nueva_sesion_id BIGINT
)
RETURNS TABLE (ok BOOLEAN, mensaje TEXT)
LANGUAGE plpgsql
AS $func$
DECLARE
  v_sesion_nueva_fecha DATE;
  v_sesion_nueva_hora TIME;
  v_sesion_vieja_fecha DATE;
  v_sesion_vieja_id BIGINT;
  v_plazas_disponibles INT;
  v_tiene_reserva_nueva BOOLEAN;
BEGIN
  /* 1. Verificar nueva sesion */
  SELECT fecha, hora, capacidad - (
    SELECT COUNT(*) FROM reservas r WHERE r.sesion_id = s.id AND r.estado = 'activa'
  )
  INTO v_sesion_nueva_fecha, v_sesion_nueva_hora, v_plazas_disponibles
  FROM sesiones s
  WHERE id = p_nueva_sesion_id;
  
  IF v_sesion_nueva_fecha IS NULL THEN
    RETURN QUERY SELECT false, 'La sesion nueva no existe.';
    RETURN;
  END IF;
  
  IF v_plazas_disponibles <= 0 THEN
    RETURN QUERY SELECT false, 'No hay plazas en la nueva sesion.';
    RETURN;
  END IF;

  /* 2. Verificar reserva actual */
  SELECT s.fecha, s.id
  INTO v_sesion_vieja_fecha, v_sesion_vieja_id
  FROM reservas r
  JOIN sesiones s ON s.id = r.sesion_id
  WHERE r.id = p_reserva_id AND r.usuario_id = p_usuario_id AND r.estado = 'activa';
  
  IF v_sesion_vieja_id IS NULL THEN
    RETURN QUERY SELECT false, 'Reserva original no encontrada o no activa.';
    RETURN;
  END IF;
  
  IF v_sesion_vieja_fecha != v_sesion_nueva_fecha THEN
    RETURN QUERY SELECT false, 'Solo se permiten cambios en el mismo dia.';
    RETURN;
  END IF;

  /* 3. Verificar si ya tiene reserva en la nueva */
  SELECT EXISTS(
    SELECT 1 FROM reservas 
    WHERE usuario_id = p_usuario_id AND sesion_id = p_nueva_sesion_id AND estado = 'activa'
  ) INTO v_tiene_reserva_nueva;
  
  IF v_tiene_reserva_nueva THEN
    RETURN QUERY SELECT false, 'Ya tienes reserva en esa sesion.';
    RETURN;
  END IF;

  /* 4. Realizar cambio */
  UPDATE reservas 
  SET estado = 'cancelada' 
  WHERE id = p_reserva_id;
  
  /* Eliminado fecha_reserva que no existe */
  INSERT INTO reservas (sesion_id, usuario_id, estado)
  VALUES (p_nueva_sesion_id, p_usuario_id, 'activa');

  /* 5. Gestionar lista de espera */
  DELETE FROM lista_espera 
  WHERE usuario_id = p_usuario_id AND sesion_id = p_nueva_sesion_id;
  
  PERFORM notificar_hueco_disponible(v_sesion_vieja_id);

  RETURN QUERY SELECT true, 'Cambio de turno realizado con exito.';
END;
$func$;
