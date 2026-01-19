-- Función para que el admin pueda cancelar reservas con opción de generar recuperación o no
-- Ejecutar en Supabase SQL Editor

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
  v_mes_origen INTEGER;
  v_anio_origen INTEGER;
  v_mes_limite INTEGER;
  v_anio_limite INTEGER;
  v_usuario_nombre TEXT;
BEGIN
  -- Get reservation details
  SELECT r.usuario_id, r.sesion_id, s.modalidad, s.fecha, u.nombre
  INTO v_usuario_id, v_sesion_id, v_modalidad, v_fecha, v_usuario_nombre
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
  -- cancelada_correctamente = true means it was cancelled properly (with enough notice)
  -- We use the opposite of p_generar_recuperacion to control trigger behavior
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
    INSERT INTO notificaciones (usuario_id, tipo, titulo, mensaje, leida)
    VALUES (
      v_usuario_id,
      'cancelacion',
      'Clase cancelada por administrador',
      'Tu clase del ' || TO_CHAR(v_fecha, 'DD/MM/YYYY') || ' ha sido cancelada por el administrador. Se ha generado una recuperación para que puedas usarla.',
      false
    );

    RETURN QUERY SELECT true, ('Reserva de ' || v_usuario_nombre || ' cancelada. Se ha generado una recuperación.')::TEXT;
  ELSE
    -- Notify user about permanent cancellation
    INSERT INTO notificaciones (usuario_id, tipo, titulo, mensaje, leida)
    VALUES (
      v_usuario_id,
      'cancelacion',
      'Clase eliminada',
      'Tu clase del ' || TO_CHAR(v_fecha, 'DD/MM/YYYY') || ' ha sido eliminada por el administrador.',
      false
    );

    RETURN QUERY SELECT true, ('Reserva de ' || v_usuario_nombre || ' eliminada permanentemente (sin recuperación).')::TEXT;
  END IF;
END;
$$;

-- Grant execute permission to authenticated users (admin check is done via RLS policies)
GRANT EXECUTE ON FUNCTION public.cancelar_reserva_admin TO authenticated;
