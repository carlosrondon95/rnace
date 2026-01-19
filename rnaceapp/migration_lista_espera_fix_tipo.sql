-- Actualización: Cambiar tipo de notificación del trigger de lista de espera
-- El trigger ahora usa 'hueco_disponible' en lugar de 'lista_espera'
-- para mostrar el icono verde del calendario que prefiere el usuario

CREATE OR REPLACE FUNCTION public.notificar_hueco_libre()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_sesion_id BIGINT;
    v_fecha DATE;
    v_hora TIME;
    v_usuario_espera UUID;
    v_count INTEGER := 0;
BEGIN
    -- Determinar sesion_id según la operación (UPDATE o DELETE)
    IF (TG_OP = 'DELETE') THEN
        v_sesion_id := OLD.sesion_id;
    ELSIF (TG_OP = 'UPDATE' AND NEW.estado = 'cancelada' AND OLD.estado = 'activa') THEN
        v_sesion_id := NEW.sesion_id;
    ELSE
        -- Si no es una cancelación efectiva, no hacemos nada
        RETURN NULL;
    END IF;

    -- Obtener detalles de la sesión para el mensaje
    SELECT fecha, hora INTO v_fecha, v_hora
    FROM public.sesiones
    WHERE id = v_sesion_id;

    -- Si no existe la sesión, salir
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- Iterar sobre todos los usuarios en lista de espera para esa sesión
    FOR v_usuario_espera IN 
        SELECT usuario_id FROM public.lista_espera WHERE sesion_id = v_sesion_id
    LOOP
        -- Insertar notificación con tipo 'hueco_disponible' (icono verde calendario)
        INSERT INTO public.notificaciones (
            usuario_id,
            tipo,
            titulo,
            mensaje,
            leida,
            sesion_id,
            accion_url,
            creado_en
        ) VALUES (
            v_usuario_espera,
            'hueco_disponible',  -- Cambiado de 'lista_espera' a 'hueco_disponible'
            '🎉 ¡Plaza Disponible!',
            'Se ha liberado un hueco en la clase del ' || to_char(v_fecha, 'DD/MM') || ' a las ' || to_char(v_hora, 'HH24:MI') || '. ¡Entra para reservar!',
            FALSE,
            v_sesion_id,
            '/calendario?sesion=' || v_sesion_id,
            NOW()
        );
        v_count := v_count + 1;
    END LOOP;

    RETURN NULL;
END;
$$;

-- El trigger ya existe, no hace falta recrearlo
