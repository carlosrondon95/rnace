-- =====================================================
-- MIGRACIÓN: Eliminar dependencia de tabla 'perfiles'
-- =====================================================

-- 1. Actualizar función 'notificar_hueco_disponible' para usar 'usuarios'
CREATE OR REPLACE FUNCTION notificar_hueco_disponible(p_sesion_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $func$
DECLARE
    v_primer_espera RECORD;
    v_sesion RECORD;
    v_titulo TEXT;
    v_mensaje TEXT;
    v_accion_url TEXT;
    v_datos JSONB;
BEGIN
    -- Obtener primer usuario en espera (no notificado aún)
    -- CORRECCIÓN: Usar tabla 'usuarios' en lugar de 'perfiles'
    SELECT le.*, u.nombre
    INTO v_primer_espera
    FROM public.lista_espera le
    LEFT JOIN public.usuarios u ON le.usuario_id = u.id
    WHERE le.sesion_id = p_sesion_id
      AND (le.notificado = FALSE OR le.notificado IS NULL)
    ORDER BY le.creado_en ASC
    LIMIT 1;
    
    IF v_primer_espera IS NULL THEN
        RETURN;
    END IF;
    
    -- Obtener datos de la sesión
    SELECT * INTO v_sesion FROM public.sesiones WHERE id = p_sesion_id;
    
    -- Crear título y mensaje
    v_titulo := '¡Plaza disponible!';
    v_mensaje := format(
        'Se ha liberado una plaza en %s el %s a las %s. ¡Reserva ahora antes de que se agote!',
        CASE v_sesion.modalidad 
            WHEN 'focus' THEN 'Grupo Focus'
            WHEN 'reducido' THEN 'Grupo Reducido'
            ELSE v_sesion.modalidad 
        END,
        TO_CHAR(v_sesion.fecha, 'DD/MM/YYYY'),
        TO_CHAR(v_sesion.hora, 'HH24:MI')
    );
    
    -- URL con ID de sesión para navegación directa
    v_accion_url := '/calendario?sesion=' || p_sesion_id::TEXT;
    
    -- Datos adicionales en JSON
    v_datos := jsonb_build_object(
        'sesion_id', p_sesion_id,
        'fecha', v_sesion.fecha,
        'hora', v_sesion.hora::TEXT,
        'modalidad', v_sesion.modalidad
    );
    
    -- Crear notificación
    INSERT INTO public.notificaciones (
        usuario_id, 
        tipo,
        titulo,
        mensaje, 
        datos,
        accion_url,
        leida,
        creado_en
    ) VALUES (
        v_primer_espera.usuario_id,
        'plaza_disponible',
        v_titulo,
        v_mensaje,
        v_datos,
        v_accion_url,
        FALSE,
        NOW()
    );
    
    -- Marcar como notificado en lista de espera
    UPDATE public.lista_espera
    SET notificado = TRUE,
        notificado_en = NOW()
    WHERE id = v_primer_espera.id;
    
END;
$func$;

-- 2. Eliminar tabla 'perfiles' si existe
DROP TABLE IF EXISTS public.perfiles;
