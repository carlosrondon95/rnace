-- =====================================================
-- MIGRACIÓN: Corrección de Concurrencia + Restricciones v3
-- =====================================================

-- 1. Mejorar cambiar_turno con bloqueo de fila y validación de MODALIDAD
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
  v_sesion_nueva_modalidad TEXT;
  
  v_sesion_vieja_fecha DATE;
  v_sesion_vieja_id BIGINT;
  v_sesion_vieja_modalidad TEXT;
  
  v_capacidad INT;
  v_ocupadas INT;
  v_tiene_reserva_nueva BOOLEAN;
BEGIN
  -- BLOQUEO: Bloquear la fila de la sesión destino
  SELECT fecha, hora, capacidad, modalidad
  INTO v_sesion_nueva_fecha, v_sesion_nueva_hora, v_capacidad, v_sesion_nueva_modalidad
  FROM sesiones 
  WHERE id = p_nueva_sesion_id
  FOR UPDATE; 
  
  IF v_sesion_nueva_fecha IS NULL THEN
    RETURN QUERY SELECT false, 'La sesion nueva no existe.';
    RETURN;
  END IF;

  -- Contar reservas activas (seguro tras bloqueo)
  SELECT COUNT(*) INTO v_ocupadas 
  FROM reservas 
  WHERE sesion_id = p_nueva_sesion_id AND estado = 'activa';
  
  IF v_ocupadas >= v_capacidad THEN
    RETURN QUERY SELECT false, 'No hay plazas en la nueva sesion.';
    RETURN;
  END IF;

  /* 2. Verificar reserva actual */
  SELECT s.fecha, s.id, s.modalidad
  INTO v_sesion_vieja_fecha, v_sesion_vieja_id, v_sesion_vieja_modalidad
  FROM reservas r
  JOIN sesiones s ON s.id = r.sesion_id
  WHERE r.id = p_reserva_id AND r.usuario_id = p_usuario_id AND r.estado = 'activa';
  
  IF v_sesion_vieja_id IS NULL THEN
    RETURN QUERY SELECT false, 'Reserva original no encontrada o no activa.';
    RETURN;
  END IF;
  
  -- A. Validar que sea dentro del MISMO MES (implica también mismo día si las fechas son iguales)
  IF EXTRACT(MONTH FROM v_sesion_vieja_fecha) != EXTRACT(MONTH FROM v_sesion_nueva_fecha) OR
     EXTRACT(YEAR FROM v_sesion_vieja_fecha) != EXTRACT(YEAR FROM v_sesion_nueva_fecha) THEN
    RETURN QUERY SELECT false, 'Solo se permiten cambios dentro del mismo mes.';
    RETURN;
  END IF;

  -- B. Validar que sea el MISMO GRUPO (Modalidad)
  IF v_sesion_vieja_modalidad != v_sesion_nueva_modalidad THEN
    RETURN QUERY SELECT false, 'Solo puedes cambiar a una clase del mismo grupo (' || v_sesion_vieja_modalidad || ').';
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
  
  IF EXISTS (SELECT 1 FROM reservas WHERE sesion_id = p_nueva_sesion_id AND usuario_id = p_usuario_id) THEN
    UPDATE reservas 
    SET estado = 'activa' 
    WHERE sesion_id = p_nueva_sesion_id AND usuario_id = p_usuario_id;
  ELSE
    INSERT INTO reservas (sesion_id, usuario_id, estado)
    VALUES (p_nueva_sesion_id, p_usuario_id, 'activa');
  END IF;

  /* 5. Gestionar lista de espera */
  DELETE FROM lista_espera 
  WHERE usuario_id = p_usuario_id AND sesion_id = p_nueva_sesion_id;
  
  -- Notificar hueco en la sesión vieja
  PERFORM notificar_hueco_disponible(v_sesion_vieja_id);

  RETURN QUERY SELECT true, 'Cambio de turno realizado con exito.';
END;
$func$;

-- 2. Mejorar usar_recuperacion con bloqueo de fila (FOR UPDATE)
-- (Sin cambios, se mantiene igual)
CREATE OR REPLACE FUNCTION usar_recuperacion(
  p_usuario_id UUID,
  p_sesion_id BIGINT
)
RETURNS TABLE (ok BOOLEAN, mensaje TEXT)
LANGUAGE plpgsql
AS $func$
DECLARE
  v_sesion_fecha DATE;
  v_sesion_modalidad TEXT;
  v_capacidad INT;
  v_ocupadas INT;
  v_mes_destino INT;
  v_anio_destino INT;
  v_recuperacion_id BIGINT;
  v_recu_mes_origen INT;
  v_recu_anio_origen INT;
  v_count_usadas_next_month INT;
BEGIN
  -- BLOQUEO
  SELECT fecha, modalidad, capacidad
  INTO v_sesion_fecha, v_sesion_modalidad, v_capacidad
  FROM sesiones 
  WHERE id = p_sesion_id AND cancelada = false
  FOR UPDATE; 

  IF v_sesion_fecha IS NULL THEN
    RETURN QUERY SELECT false, 'Sesión no encontrada.';
    RETURN;
  END IF;

  v_mes_destino := EXTRACT(MONTH FROM v_sesion_fecha);
  v_anio_destino := EXTRACT(YEAR FROM v_sesion_fecha);

  -- Verificar disponibilidad
  SELECT COUNT(*) INTO v_ocupadas FROM reservas WHERE sesion_id = p_sesion_id AND estado = 'activa';
  
  IF v_ocupadas >= v_capacidad THEN
    RETURN QUERY SELECT false, 'La clase está completa.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM reservas WHERE usuario_id = p_usuario_id AND sesion_id = p_sesion_id AND estado = 'activa') THEN
    RETURN QUERY SELECT false, 'Ya tienes reserva en esta clase.';
    RETURN;
  END IF;

  -- A. Prioridad: Recuperación del MISMO mes
  SELECT id, mes_origen, anio_origen
  INTO v_recuperacion_id, v_recu_mes_origen, v_recu_anio_origen
  FROM recuperaciones
  WHERE usuario_id = p_usuario_id 
    AND estado = 'disponible'
    AND modalidad = v_sesion_modalidad
    AND mes_origen = v_mes_destino
    AND anio_origen = v_anio_destino
  LIMIT 1;

  -- B. Si no, buscar del mes anterior
  IF v_recuperacion_id IS NULL THEN
    
    SELECT COUNT(*)
    INTO v_count_usadas_next_month
    FROM recuperaciones
    WHERE usuario_id = p_usuario_id
      AND mes_uso = v_mes_destino
      AND anio_uso = v_anio_destino
      AND (mes_origen != v_mes_destino OR anio_origen != v_anio_destino)
      AND estado = 'usada';

    IF v_count_usadas_next_month >= 1 THEN
      RETURN QUERY SELECT false, 'Ya has usado tu única recuperación permitida del mes anterior para este mes.';
      RETURN;
    END IF;

    SELECT id, mes_origen, anio_origen
    INTO v_recuperacion_id, v_recu_mes_origen, v_recu_anio_origen
    FROM recuperaciones
    WHERE usuario_id = p_usuario_id
      AND estado = 'disponible'
      AND modalidad = v_sesion_modalidad
      AND (
        (anio_limite > v_anio_destino) OR 
        (anio_limite = v_anio_destino AND mes_limite >= v_mes_destino)
      )
      AND (
        (anio_origen < v_anio_destino) OR
        (anio_origen = v_anio_destino AND mes_origen <= v_mes_destino)
      )
      AND (mes_origen != v_mes_destino OR anio_origen != v_anio_destino)
    ORDER BY fecha_creacion ASC
    LIMIT 1;
    
    IF v_recuperacion_id IS NULL THEN
      RETURN QUERY SELECT false, 'No tienes recuperaciones válidas (' || v_sesion_modalidad || ') para esta fecha.';
      RETURN;
    END IF;

  END IF;

  -- Ejecutar uso
  UPDATE recuperaciones
  SET estado = 'usada',
      fecha_uso = NOW(),
      sesion_uso_id = p_sesion_id,
      mes_uso = v_mes_destino,
      anio_uso = v_anio_destino
  WHERE id = v_recuperacion_id;

  INSERT INTO reservas (sesion_id, usuario_id, estado, es_recuperacion, es_desde_horario_fijo)
  VALUES (p_sesion_id, p_usuario_id, 'activa', true, false);

  DELETE FROM lista_espera WHERE usuario_id = p_usuario_id AND sesion_id = p_sesion_id;

  RETURN QUERY SELECT true, 'Recuperación aplicada correctamente.';
END;
$func$;
