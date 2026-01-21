-- Migration: Añadir notificación a lista de espera cuando se cancela una reserva
-- Esta migración actualiza la función cancelar_reserva_admin para notificar
-- al primer usuario en lista de espera cuando se libera una plaza

CREATE OR REPLACE FUNCTION public.cancelar_reserva_admin(
  p_reserva_id INTEGER,
  p_generar_recuperacion BOOLEAN DEFAULT true
)
RETURNS TABLE(ok BOOLEAN, mensaje TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usuario_id UUID;
  v_sesion_id INTEGER;
  v_modalidad TEXT;
  v_fecha DATE;
  v_hora TEXT;
  v_mes_origen INTEGER;
  v_anio_origen INTEGER;
  v_mes_limite INTEGER;
  v_anio_limite INTEGER;
  v_usuario_nombre TEXT;
  v_espera_usuario_id UUID;
BEGIN
  -- Get reservation details
  SELECT r.usuario_id, r.sesion_id, s.modalidad, s.fecha, s.hora::TEXT, u.nombre
  INTO v_usuario_id, v_sesion_id, v_modalidad, v_fecha, v_hora, v_usuario_nombre
  FROM reservas r
  JOIN sesiones s ON s.id = r.sesion_id
  JOIN usuarios u ON u.id = r.usuario_id
  WHERE r.id = p_reserva_id AND r.estado = 'activa';

  IF v_usuario_id IS NULL THEN
    RETURN QUERY SELECT false, 'Reserva no encontrada o ya cancelada'::TEXT;
    RETURN;
  END IF;

  -- Calculate recovery period
  v_mes_origen := EXTRACT(MONTH FROM v_fecha)::INTEGER;
  v_anio_origen := EXTRACT(YEAR FROM v_fecha)::INTEGER;
  v_mes_limite := CASE WHEN v_mes_origen = 12 THEN 1 ELSE v_mes_origen + 1 END;
  v_anio_limite := CASE WHEN v_mes_origen = 12 THEN v_anio_origen + 1 ELSE v_anio_origen END;

  -- Cancel the reservation
  UPDATE reservas
  SET estado = 'cancelada',
      cancelada_en = NOW(),
      cancelada_correctamente = NOT p_generar_recuperacion
  WHERE id = p_reserva_id;

  -- Generate recovery if requested
  IF p_generar_recuperacion THEN
    INSERT INTO recuperaciones (
      usuario_id,
      sesion_cancelada_id,
      modalidad,
      mes_origen,
      anio_origen,
      mes_limite,
      anio_limite,
      estado
    ) VALUES (
      v_usuario_id,
      v_sesion_id,
      v_modalidad,
      v_mes_origen,
      v_anio_origen,
      v_mes_limite,
      v_anio_limite,
      'disponible'
    );

    -- Notify user about cancellation with recovery
    INSERT INTO notificaciones (usuario_id, tipo, titulo, mensaje, sesion_id, leida)
    VALUES (
      v_usuario_id,
      'cancelacion',
      'Clase cancelada por administrador',
      'Tu clase del ' || TO_CHAR(v_fecha, 'DD/MM/YYYY') || ' a las ' || SUBSTRING(v_hora FROM 1 FOR 5) || ' ha sido cancelada. Se ha generado una recuperación.',
      v_sesion_id,
      false
    );
  ELSE
    -- Notify user about permanent cancellation
    INSERT INTO notificaciones (usuario_id, tipo, titulo, mensaje, sesion_id, leida)
    VALUES (
      v_usuario_id,
      'cancelacion',
      'Clase eliminada',
      'Tu clase del ' || TO_CHAR(v_fecha, 'DD/MM/YYYY') || ' a las ' || SUBSTRING(v_hora FROM 1 FOR 5) || ' ha sido eliminada por el administrador.',
      v_sesion_id,
      false
    );
  END IF;

  -- ============ NOTIFICAR A LISTA DE ESPERA ============
  -- Buscar el primer usuario en lista de espera para esta sesión (ordenado por fecha de inscripción)
  SELECT le.usuario_id INTO v_espera_usuario_id
  FROM lista_espera le
  WHERE le.sesion_id = v_sesion_id
  ORDER BY le.creado_en ASC
  LIMIT 1;

  -- Si hay alguien en lista de espera, notificarle
  IF v_espera_usuario_id IS NOT NULL THEN
    INSERT INTO notificaciones (usuario_id, tipo, titulo, mensaje, sesion_id, leida)
    VALUES (
      v_espera_usuario_id,
      'plaza_disponible',
      '¡Plaza disponible!',
      'Se ha liberado una plaza para el ' || TO_CHAR(v_fecha, 'DD/MM/YYYY') || ' a las ' || SUBSTRING(v_hora FROM 1 FOR 5) || '. ¡Confírmala antes de que se agote!',
      v_sesion_id,
      false
    );
    
    -- También podemos llamar a la Edge Function para enviar push notification
    -- Esto se hace mediante pg_net o un trigger separado
  END IF;

  IF p_generar_recuperacion THEN
    RETURN QUERY SELECT true, ('Reserva de ' || v_usuario_nombre || ' cancelada. Se ha generado una recuperación.')::TEXT;
  ELSE
    RETURN QUERY SELECT true, ('Reserva de ' || v_usuario_nombre || ' eliminada permanentemente (sin recuperación).')::TEXT;
  END IF;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.cancelar_reserva_admin TO authenticated;

-- NOTA: Esta función ahora:
-- 1. Cancela la reserva del usuario
-- 2. Genera recuperación si se solicita
-- 3. Notifica al usuario cuya reserva fue cancelada
-- 4. Notifica al PRIMER usuario en lista de espera que hay plaza disponible
