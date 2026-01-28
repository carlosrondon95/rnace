-- Migración para optimizar regenerar_reservas_futuras
-- Ahora acepta un parámetro opcional p_usuario_id para regenerar solo un usuario específico.

-- Primero eliminamos la función anterior para cambiar la firma
DROP FUNCTION IF EXISTS regenerar_reservas_futuras();

CREATE OR REPLACE FUNCTION regenerar_reservas_futuras(p_usuario_id UUID DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
    v_usuario RECORD;
    v_mes RECORD;
    v_sesion RECORD;
    v_horario RECORD;
    v_reserva_id BIGINT;
    v_contador INTEGER := 0;
    v_eliminadas INTEGER := 0;
    v_hoy DATE := CURRENT_DATE;
    v_sistema_dia INTEGER;
    v_key TEXT;
    v_horarios_usuario TEXT[]; -- Array de claves 'dia-hora-modalidad'
BEGIN
    -- 1. Iterar sobre todos los meses abiertos
    FOR v_mes IN 
        SELECT anio, mes FROM agenda_mes WHERE abierto = true
    LOOP
        -- 2. Iterar sobre usuarios activos tipo cliente
        -- Si p_usuario_id es proporcionado, filtramos solo ese usuario.
        FOR v_usuario IN 
            SELECT id FROM usuarios 
            WHERE rol = 'cliente' 
            AND activo = true
            AND (p_usuario_id IS NULL OR id = p_usuario_id)
        LOOP
            -- Reiniciar array de horarios para este usuario
            v_horarios_usuario := ARRAY[]::TEXT[];
            
            -- 3. Obtener horarios fijos del usuario (incluyendo modalidad)
            FOR v_horario IN 
                SELECT hd.dia_semana, hd.hora, hd.modalidad
                FROM horario_fijo_usuario hfu
                JOIN horarios_disponibles hd ON hfu.horario_disponible_id = hd.id
                WHERE hfu.usuario_id = v_usuario.id AND hfu.activo = true
            LOOP
                -- Construir clave: dia-hora-modalidad (ej: "1-16:00-focus")
                v_horarios_usuario := array_append(v_horarios_usuario, 
                    v_horario.dia_semana || '-' || SUBSTRING(v_horario.hora::text FROM 1 FOR 5) || '-' || v_horario.modalidad);
            END LOOP;
            
            -- Si no tiene horarios fijos, saltar
            IF array_length(v_horarios_usuario, 1) IS NULL THEN
                CONTINUE;
            END IF;

            -- 4. Obtener sesiones futuras para este mes
            -- Solo sesiones desde hoy en adelante que coincidan con el mes del loop
            FOR v_sesion IN 
                SELECT id, fecha, hora, modalidad
                FROM sesiones
                WHERE fecha >= v_hoy
                AND EXTRACT(YEAR FROM fecha) = v_mes.anio
                AND EXTRACT(MONTH FROM fecha) = v_mes.mes
                AND cancelada = false
            LOOP
                -- Calcular día de la semana (1=Lun ... 7=Dom)
                v_sistema_dia := EXTRACT(ISODOW FROM v_sesion.fecha);
                
                -- Construir clave de la sesión
                v_key := v_sistema_dia || '-' || SUBSTRING(v_sesion.hora::text FROM 1 FOR 5) || '-' || v_sesion.modalidad;
                
                -- 5. Verificar coincidencia
                IF v_key = ANY(v_horarios_usuario) THEN
                    -- Verificar si ya existe reserva
                    PERFORM 1 FROM reservas 
                    WHERE usuario_id = v_usuario.id 
                    AND sesion_id = v_sesion.id 
                    AND estado = 'activa';
                    
                    IF NOT FOUND THEN
                        -- Crear reserva (CORREGIDO: creada_en en lugar de created_at)
                        INSERT INTO reservas (usuario_id, sesion_id, estado, es_desde_horario_fijo, creada_en)
                        VALUES (v_usuario.id, v_sesion.id, 'activa', true, NOW());
                        v_contador := v_contador + 1;
                    END IF;
                ELSE
                    -- 6. LIMPIEZA: Si existe una reserva automática ('es_desde_horario_fijo')
                    -- para esta sesión pero YA NO coincide con el horario fijo (porque cambió la clave),
                    -- la eliminamos.
                    
                    DELETE FROM reservas
                    WHERE usuario_id = v_usuario.id 
                    AND sesion_id = v_sesion.id
                    AND estado = 'activa'
                    AND es_desde_horario_fijo = true;
                    
                    GET DIAGNOSTICS v_reserva_id = ROW_COUNT;
                    v_eliminadas := v_eliminadas + v_reserva_id;
                END IF;
                
            END LOOP; -- Fin loop sesiones
        END LOOP; -- Fin loop usuarios
    END LOOP; -- Fin loop meses
    
    RETURN json_build_object(
        'ok', true, 
        'mensaje', 'Regeneración completada', 
        'reservas_creadas', v_contador,
        'reservas_eliminadas', v_eliminadas
    );
END;
$$;
