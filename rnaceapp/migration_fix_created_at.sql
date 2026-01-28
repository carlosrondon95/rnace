-- Migración para corregir error en regenerar_reservas_futuras
-- Problema 1: La función usaba "created_at" pero la columna correcta es "creada_en"
-- Problema 2: La verificación de duplicados solo miraba estado='activa', pero el constraint unique
--             es sobre (sesion_id, usuario_id) sin importar estado. 
--             Ahora verificamos si existe CUALQUIER reserva y la reactivamos si estaba cancelada.
-- Fecha: 2026-01-28

DROP FUNCTION IF EXISTS regenerar_reservas_futuras(UUID);

CREATE OR REPLACE FUNCTION regenerar_reservas_futuras(p_usuario_id UUID DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
    v_usuario RECORD;
    v_mes RECORD;
    v_sesion RECORD;
    v_horario RECORD;
    v_reserva_existente RECORD;
    v_contador INTEGER := 0;
    v_reactivadas INTEGER := 0;
    v_eliminadas INTEGER := 0;
    v_hoy DATE := CURRENT_DATE;
    v_sistema_dia INTEGER;
    v_key TEXT;
    v_horarios_usuario TEXT[];
BEGIN
    -- 1. Iterar sobre todos los meses abiertos
    FOR v_mes IN 
        SELECT anio, mes FROM agenda_mes WHERE abierto = true
    LOOP
        -- 2. Iterar sobre usuarios activos tipo cliente
        FOR v_usuario IN 
            SELECT id FROM usuarios 
            WHERE rol = 'cliente' 
            AND activo = true
            AND (p_usuario_id IS NULL OR id = p_usuario_id)
        LOOP
            -- Reiniciar array de horarios para este usuario
            v_horarios_usuario := ARRAY[]::TEXT[];
            
            -- 3. Obtener horarios fijos del usuario
            FOR v_horario IN 
                SELECT hd.dia_semana, hd.hora, hd.modalidad
                FROM horario_fijo_usuario hfu
                JOIN horarios_disponibles hd ON hfu.horario_disponible_id = hd.id
                WHERE hfu.usuario_id = v_usuario.id AND hfu.activo = true
            LOOP
                v_horarios_usuario := array_append(v_horarios_usuario, 
                    v_horario.dia_semana || '-' || SUBSTRING(v_horario.hora::text FROM 1 FOR 5) || '-' || v_horario.modalidad);
            END LOOP;
            
            -- Si no tiene horarios fijos, saltar
            IF array_length(v_horarios_usuario, 1) IS NULL THEN
                CONTINUE;
            END IF;

            -- 4. Obtener sesiones futuras para este mes
            FOR v_sesion IN 
                SELECT id, fecha, hora, modalidad
                FROM sesiones
                WHERE fecha >= v_hoy
                AND EXTRACT(YEAR FROM fecha) = v_mes.anio
                AND EXTRACT(MONTH FROM fecha) = v_mes.mes
                AND cancelada = false
            LOOP
                v_sistema_dia := EXTRACT(ISODOW FROM v_sesion.fecha);
                v_key := v_sistema_dia || '-' || SUBSTRING(v_sesion.hora::text FROM 1 FOR 5) || '-' || v_sesion.modalidad;
                
                -- 5. Verificar coincidencia
                IF v_key = ANY(v_horarios_usuario) THEN
                    -- Buscar si existe CUALQUIER reserva (activa o cancelada)
                    SELECT id, estado INTO v_reserva_existente
                    FROM reservas 
                    WHERE usuario_id = v_usuario.id 
                    AND sesion_id = v_sesion.id
                    LIMIT 1;
                    
                    IF v_reserva_existente.id IS NULL THEN
                        -- No existe, crear nueva
                        INSERT INTO reservas (usuario_id, sesion_id, estado, es_desde_horario_fijo, creada_en)
                        VALUES (v_usuario.id, v_sesion.id, 'activa', true, NOW());
                        v_contador := v_contador + 1;
                    ELSIF v_reserva_existente.estado != 'activa' THEN
                        -- Existe pero está cancelada, reactivarla
                        UPDATE reservas 
                        SET estado = 'activa', 
                            es_desde_horario_fijo = true,
                            cancelada_en = NULL,
                            cancelada_correctamente = NULL
                        WHERE id = v_reserva_existente.id;
                        v_reactivadas := v_reactivadas + 1;
                    END IF;
                    -- Si ya existe y está activa, no hacer nada
                ELSE
                    -- 6. LIMPIEZA: Eliminar reservas automáticas que ya no coinciden
                    DELETE FROM reservas
                    WHERE usuario_id = v_usuario.id 
                    AND sesion_id = v_sesion.id
                    AND estado = 'activa'
                    AND es_desde_horario_fijo = true;
                    
                    GET DIAGNOSTICS v_eliminadas = ROW_COUNT;
                END IF;
                
            END LOOP;
        END LOOP;
    END LOOP;
    
    RETURN json_build_object(
        'ok', true, 
        'mensaje', 'Regeneración completada', 
        'reservas_creadas', v_contador,
        'reservas_reactivadas', v_reactivadas,
        'reservas_eliminadas', v_eliminadas
    );
END;
$$;
