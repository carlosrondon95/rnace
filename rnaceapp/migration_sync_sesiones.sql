-- Script para sincronizar sesiones faltantes con horarios_disponibles
-- Esto creará sesiones para los horarios nuevos que no fueron sincronizados correctamente

-- Este script hace dos cosas:
-- 1. Crea sesiones faltantes para todos los horarios_disponibles activos
-- 2. Regenera las reservas para usuarios con horarios fijos

DO $$
DECLARE
    v_mes RECORD;
    v_horario RECORD;
    v_fecha DATE;
    v_dia_js INTEGER;
    v_contador INTEGER := 0;
    v_primer_dia DATE;
    v_ultimo_dia DATE;
BEGIN
    RAISE NOTICE 'Iniciando sincronización de sesiones faltantes...';
    
    -- 1. Iterar sobre todos los meses abiertos
    FOR v_mes IN 
        SELECT anio, mes FROM agenda_mes WHERE abierto = true
    LOOP
        v_primer_dia := make_date(v_mes.anio, v_mes.mes, 1);
        v_ultimo_dia := (v_primer_dia + interval '1 month - 1 day')::date;
        
        RAISE NOTICE 'Procesando mes: % - %', v_mes.anio, v_mes.mes;
        
        -- 2. Iterar sobre cada horario_disponible activo
        FOR v_horario IN 
            SELECT id, dia_semana, hora, modalidad, capacidad_maxima
            FROM horarios_disponibles
            WHERE activo = true
        LOOP
            -- 3. Iterar sobre cada día del mes
            v_fecha := v_primer_dia;
            WHILE v_fecha <= v_ultimo_dia LOOP
                -- Calcular día de la semana (ISODOW: 1=Lun, 2=Mar, ... 5=Vie, 6=Sáb, 7=Dom)
                v_dia_js := EXTRACT(ISODOW FROM v_fecha);
                
                -- Verificar si este día coincide con el horario
                IF v_dia_js = v_horario.dia_semana AND v_fecha >= CURRENT_DATE THEN
                    -- Verificar si ya existe la sesión
                    IF NOT EXISTS (
                        SELECT 1 FROM sesiones 
                        WHERE fecha = v_fecha 
                        AND hora = v_horario.hora 
                        AND modalidad = v_horario.modalidad
                    ) THEN
                        -- Crear la sesión (usando columnas correctas: fecha, hora, modalidad, capacidad, cancelada)
                        INSERT INTO sesiones (fecha, hora, modalidad, capacidad, cancelada)
                        VALUES (v_fecha, v_horario.hora, v_horario.modalidad, v_horario.capacidad_maxima, false);
                        
                        v_contador := v_contador + 1;
                    END IF;
                END IF;
                
                v_fecha := v_fecha + interval '1 day';
            END LOOP;
        END LOOP;
    END LOOP;
    
    RAISE NOTICE 'Sesiones creadas: %', v_contador;
END;
$$;

-- 2. Ver las sesiones creadas a las 04:10
SELECT fecha, hora, modalidad, capacidad, cancelada
FROM sesiones
WHERE hora = '04:10:00'
ORDER BY fecha;

-- 3. Regenerar reservas (esto usará la función corregida)
SELECT regenerar_reservas_futuras();
