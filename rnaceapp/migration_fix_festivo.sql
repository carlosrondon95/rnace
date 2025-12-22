CREATE OR REPLACE FUNCTION public.procesar_festivo()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_sesion RECORD;
    v_reserva RECORD;
    v_recuperacion_id UUID;
    v_titulo TEXT;
    v_mensaje TEXT;
    v_datos JSONB;
BEGIN
    -- Iterar sobre todas las sesiones del día festivo
    FOR v_sesion IN 
        SELECT * FROM public.sesiones 
        WHERE fecha = NEW.fecha AND cancelada = FALSE
    LOOP
        -- Marcar sesión como cancelada
        UPDATE public.sesiones 
        SET cancelada = TRUE 
        WHERE id = v_sesion.id;

        -- Iterar sobre las reservas de esa sesión
        FOR v_reserva IN 
            SELECT * FROM public.reservas 
            WHERE sesion_id = v_sesion.id AND estado = 'activa'
        LOOP
            -- 1. Actualizar estado de reserva
            UPDATE public.reservas 
            SET estado = 'cancelada_sistema',
                updated_at = NOW()
            WHERE id = v_reserva.id;

            -- 2. Generar recuperación (si corresponde)
            -- Lógica simplificada: Siempre genera recuperación por festivo
            -- OJO: Ajustar según lógica de negocio real si es necesario (ej: caducidad mes siguiente)
            
            INSERT INTO public.recuperaciones (
                usuario_id,
                origen_reserva_id,
                modalidad,
                estado,
                mes_limite, -- Asumo que se mantiene la lógica de caducidad
                anio_limite,
                creado_en
            ) VALUES (
                v_reserva.usuario_id,
                v_reserva.id,
                v_sesion.modalidad,
                'disponible',
                EXTRACT(MONTH FROM NEW.fecha) + 1, -- Lógica original: mes siguiente
                EXTRACT(YEAR FROM NEW.fecha), -- Ojo con diciembre -> enero
                NOW()
            ) RETURNING id INTO v_recuperacion_id;

            -- Corrección de año si mes es 13 (Diciembre -> Enero)
            IF EXTRACT(MONTH FROM NEW.fecha) = 12 THEN
               UPDATE public.recuperaciones
               SET mes_limite = 1, anio_limite = anio_limite + 1
               WHERE id = v_recuperacion_id;
            END IF;

            -- 3. Crear notificación con MENSAJE CORREGIDO
            v_titulo := 'Clase cancelada por festivo';
            -- Antes: "... se ha generado una recuperación para el mes siguiente"
            -- Ahora: "... se ha generado una recuperación."
            v_mensaje := 'La clase del ' || TO_CHAR(NEW.fecha, 'DD/MM/YYYY') || ' coincide con festivo (' || NEW.descripcion || '). Se ha generado una recuperación en tu cuenta.';
            
            INSERT INTO public.notificaciones (
                usuario_id,
                tipo, -- 'festivo'
                titulo,
                mensaje,
                datos,
                leida,
                creado_en
            ) VALUES (
                v_reserva.usuario_id,
                'festivo',
                v_titulo,
                v_mensaje,
                jsonb_build_object('recuperacion_id', v_recuperacion_id, 'sesion_id', v_sesion.id),
                FALSE,
                NOW()
            );

        END LOOP;
    END LOOP;

    RETURN NEW;
END;
$$;
