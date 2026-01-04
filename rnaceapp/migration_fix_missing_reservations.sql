-- Migración: Función para recuperar reservas recurrentes perdidas
-- Descripción: Genera las reservas en la tabla 'reservas' para todas las sesiones futuras
-- basándose en la configuración de 'horario_fijo_usuario'.

CREATE OR REPLACE FUNCTION public.regenerar_reservas_futuras()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_hoy DATE := CURRENT_DATE;
    v_count INTEGER := 0;
BEGIN
    -- Insertamos reservas solo si no existen ya
    INSERT INTO public.reservas (usuario_id, sesion_id, estado, es_desde_horario_fijo, es_recuperacion)
    SELECT DISTINCT
        hfu.usuario_id,
        s.id,
        'activa',
        TRUE, -- Flag para indicar que viene del horario fijo
        FALSE
    FROM public.sesiones s
    -- Unimos sesiones con horarios disponibles por HORA
    JOIN public.horarios_disponibles hd 
        ON s.hora = hd.hora 
        -- Y por DÍA DE LA SEMANA (Soportando convención 0=Lun o 1=Lun)
        AND (
            (EXTRACT(ISODOW FROM s.fecha)::int = hd.dia_semana) 
            OR 
            ((EXTRACT(ISODOW FROM s.fecha)::int - 1) = hd.dia_semana)
        )
    -- Unimos con los usuarios que tienen ese horario fijo
    JOIN public.horario_fijo_usuario hfu ON hfu.horario_disponible_id = hd.id
    WHERE s.fecha >= v_hoy 
      AND s.cancelada = FALSE
      AND hfu.activo = TRUE
      -- CRÍTICO: No duplicar si ya existe reserva (activa o cancelada)
      AND NOT EXISTS (
          SELECT 1 FROM public.reservas r 
          WHERE r.sesion_id = s.id AND r.usuario_id = hfu.usuario_id
      );

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN 'Reservas generadas automáticamente: ' || v_count;
END;
$$;

-- Ejecución inmediata para reparar los datos actuales
SELECT public.regenerar_reservas_futuras();
