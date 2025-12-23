-- =====================================================
-- MIGRACIÓN: Sistema de Cambios de Cita Mejorado
-- =====================================================

-- 1. Añadir columnas para configuración híbrida en plan_usuario
ALTER TABLE plan_usuario 
ADD COLUMN IF NOT EXISTS clases_focus SMALLINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS clases_reducido SMALLINT DEFAULT 0;

-- Comentarios explicativos:
-- Para usuarios híbridos, estos valores indican cuántas clases de cada tipo tienen:
-- 1+1: clases_focus=1, clases_reducido=1
-- 1+2: clases_focus=1, clases_reducido=2
-- 2+1: clases_focus=2, clases_reducido=1
-- 2+2: clases_focus=2, clases_reducido=2

-- Para usuarios no híbridos (focus o reducido puro), estos valores se ignoran
-- y se usa el conteo de horarios_fijos directamente.

-- =====================================================
-- 2. Nueva función cambiar_turno sin restricción de mismo día
-- =====================================================

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
  v_sesion_vieja_id BIGINT;
  v_sesion_vieja_modalidad TEXT;
  v_plazas_disponibles INT;
  v_tiene_reserva_nueva BOOLEAN;
  v_tipo_grupo TEXT;
  v_ahora TIMESTAMP;
BEGIN
  v_ahora := NOW();

  -- 1. Obtener tipo de grupo del usuario
  SELECT tipo_grupo INTO v_tipo_grupo
  FROM plan_usuario
  WHERE usuario_id = p_usuario_id;

  IF v_tipo_grupo IS NULL THEN
    RETURN QUERY SELECT false, 'Usuario sin plan asignado.';
    RETURN;
  END IF;

  -- 2. Verificar nueva sesión existe y tiene plazas
  SELECT 
    s.fecha, 
    s.hora, 
    s.modalidad,
    s.capacidad - COALESCE((
      SELECT COUNT(*) FROM reservas r 
      WHERE r.sesion_id = s.id AND r.estado = 'activa'
    ), 0)
  INTO v_sesion_nueva_fecha, v_sesion_nueva_hora, v_sesion_nueva_modalidad, v_plazas_disponibles
  FROM sesiones s
  WHERE id = p_nueva_sesion_id AND cancelada = false;
  
  IF v_sesion_nueva_fecha IS NULL THEN
    RETURN QUERY SELECT false, 'La sesión destino no existe o está cancelada.';
    RETURN;
  END IF;

  -- 3. Verificar que la sesión destino no ha comenzado
  IF (v_sesion_nueva_fecha + v_sesion_nueva_hora) <= v_ahora THEN
    RETURN QUERY SELECT false, 'La sesión destino ya ha comenzado.';
    RETURN;
  END IF;
  
  IF v_plazas_disponibles <= 0 THEN
    RETURN QUERY SELECT false, 'No hay plazas disponibles en la sesión destino.';
    RETURN;
  END IF;

  -- 4. Verificar reserva actual del usuario
  SELECT s.id, s.modalidad
  INTO v_sesion_vieja_id, v_sesion_vieja_modalidad
  FROM reservas r
  JOIN sesiones s ON s.id = r.sesion_id
  WHERE r.id = p_reserva_id AND r.usuario_id = p_usuario_id AND r.estado = 'activa';
  
  IF v_sesion_vieja_id IS NULL THEN
    RETURN QUERY SELECT false, 'Reserva original no encontrada o no activa.';
    RETURN;
  END IF;

  -- 5. Verificar compatibilidad de modalidad según tipo de grupo
  -- Focus solo puede cambiar a Focus
  -- Reducido solo puede cambiar a Reducido  
  -- Híbrido puede cambiar solo dentro de la misma modalidad (focus->focus, reducido->reducido)
  IF v_sesion_vieja_modalidad != v_sesion_nueva_modalidad THEN
    RETURN QUERY SELECT false, 'Solo puedes cambiar a sesiones de la misma modalidad (' || v_sesion_vieja_modalidad || ').';
    RETURN;
  END IF;

  -- Verificar que el usuario puede usar esa modalidad
  IF v_tipo_grupo = 'focus' AND v_sesion_nueva_modalidad != 'focus' THEN
    RETURN QUERY SELECT false, 'Tu plan solo permite sesiones Focus.';
    RETURN;
  END IF;

  IF v_tipo_grupo = 'reducido' AND v_sesion_nueva_modalidad != 'reducido' THEN
    RETURN QUERY SELECT false, 'Tu plan solo permite sesiones Reducido.';
    RETURN;
  END IF;

  -- Híbrido: validar que la modalidad está permitida (ya verificamos arriba que es misma modalidad)
  -- No necesita verificación adicional aquí

  -- 6. Verificar si ya tiene reserva en la sesión destino
  SELECT EXISTS(
    SELECT 1 FROM reservas 
    WHERE usuario_id = p_usuario_id AND sesion_id = p_nueva_sesion_id AND estado = 'activa'
  ) INTO v_tiene_reserva_nueva;
  
  IF v_tiene_reserva_nueva THEN
    RETURN QUERY SELECT false, 'Ya tienes una reserva en esa sesión.';
    RETURN;
  END IF;

  -- 7. Realizar el cambio
  -- Cancelar reserva original
  UPDATE reservas 
  SET estado = 'cancelada', cancelada_en = v_ahora
  WHERE id = p_reserva_id;
  
  -- Crear o reactivar reserva en sesión destino
  IF EXISTS (SELECT 1 FROM reservas WHERE sesion_id = p_nueva_sesion_id AND usuario_id = p_usuario_id) THEN
    UPDATE reservas 
    SET estado = 'activa', cancelada_en = NULL
    WHERE sesion_id = p_nueva_sesion_id AND usuario_id = p_usuario_id;
  ELSE
    INSERT INTO reservas (sesion_id, usuario_id, estado, es_desde_horario_fijo)
    VALUES (p_nueva_sesion_id, p_usuario_id, 'activa', false);
  END IF;

  -- 8. Quitar de lista de espera si estaba
  DELETE FROM lista_espera 
  WHERE usuario_id = p_usuario_id AND sesion_id = p_nueva_sesion_id;
  
  -- 9. Notificar hueco disponible en sesión original
  PERFORM notificar_hueco_disponible(v_sesion_vieja_id);

  RETURN QUERY SELECT true, 'Cambio de turno realizado correctamente.';
END;
$func$;
