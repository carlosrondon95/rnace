-- Add clases_por_mes column to plan_usuario
ALTER TABLE public.plan_usuario 
ADD COLUMN IF NOT EXISTS clases_por_mes INTEGER DEFAULT 0;

-- Update usar_recuperacion to handle 'especial' group logic
-- We will re-define the function to be more flexible for special plans.

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
  v_tipo_grupo TEXT;
  v_clases_por_mes INT;
  v_limite_recuperaciones INT;
BEGIN
  -- Verificar sesión
  SELECT fecha, modalidad, capacidad
  INTO v_sesion_fecha, v_sesion_modalidad, v_capacidad
  FROM sesiones 
  WHERE id = p_sesion_id AND cancelada = false;

  IF v_sesion_fecha IS NULL THEN
    RETURN QUERY SELECT false, 'Sesión no encontrada.';
    RETURN;
  END IF;

  v_mes_destino := EXTRACT(MONTH FROM v_sesion_fecha);
  v_anio_destino := EXTRACT(YEAR FROM v_sesion_fecha);

  -- Obtener info del plan usuario
  SELECT tipo_grupo, COALESCE(clases_por_mes, 0)
  INTO v_tipo_grupo, v_clases_por_mes
  FROM plan_usuario
  WHERE usuario_id = p_usuario_id;

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

  -- A. Prioridad: Recuperación del MISMO mes (no gasta cupo 'next month')
  SELECT id, mes_origen, anio_origen
  INTO v_recuperacion_id, v_recu_mes_origen, v_recu_anio_origen
  FROM recuperaciones
  WHERE usuario_id = p_usuario_id 
    AND estado = 'disponible'
    AND modalidad = v_sesion_modalidad
    AND mes_origen = v_mes_destino
    AND anio_origen = v_anio_destino
  LIMIT 1;

  -- B. Si no, buscar del mes anterior (Con límite)
  IF v_recuperacion_id IS NULL THEN
    
    -- Definir límite según grupo
    IF v_tipo_grupo = 'especial' THEN
        -- Para Especial: Límite relajado (usamos el nº de clases por mes como referencia, o 4 por defecto si es 0, para ser generosos)
        -- Si clases_por_mes es 0 (legacy), permitimos 1. Si es > 0, permitimos ese número.
        IF v_clases_por_mes > 0 THEN
            v_limite_recuperaciones := v_clases_por_mes;
        ELSE
            v_limite_recuperaciones := 99; -- Infinito/Generoso si no está definido (o tratar como VIP)
        END IF;
    ELSE
        -- Estándar (Focus/Reducido): 1
        v_limite_recuperaciones := 1;
    END IF;

    -- Contar cuántas "arrastradas" ya se han usado este mes
    SELECT COUNT(*)
    INTO v_count_usadas_next_month
    FROM recuperaciones
    WHERE usuario_id = p_usuario_id
      AND mes_uso = v_mes_destino
      AND anio_uso = v_anio_destino
      AND (mes_origen != v_mes_destino OR anio_origen != v_anio_destino)
      AND estado = 'usada';

    IF v_count_usadas_next_month >= v_limite_recuperaciones THEN
      IF v_tipo_grupo = 'especial' THEN
          RETURN QUERY SELECT false, 'Has alcanzado tu límite de recuperaciones de meses anteriores (' || v_limite_recuperaciones || ') para este mes.';
      ELSE
          RETURN QUERY SELECT false, 'Ya has usado tu única recuperación permitida del mes anterior para este mes.';
      END IF;
      RETURN;
    END IF;

    -- Buscar una recuperación válida de meses anteriores
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
