-- Fix: recuperaciones de meses pasados siguen apareciendo como disponibles
-- Problema: obtener_recuperaciones_usuario devolvía TODAS las recuperaciones
-- con estado='disponible' sin verificar si ya están caducadas (mes_limite pasado).
-- Esto causaba que recuperaciones de marzo aparecieran en mayo.

-- 1. Marcar como caducadas las recuperaciones cuyo mes_limite ya pasó
UPDATE recuperaciones
SET estado = 'caducada'
WHERE estado = 'disponible'
  AND (
    anio_limite < EXTRACT(YEAR FROM CURRENT_DATE)::integer
    OR (anio_limite = EXTRACT(YEAR FROM CURRENT_DATE)::integer
        AND mes_limite < EXTRACT(MONTH FROM CURRENT_DATE)::integer)
  );

-- 2. Reemplazar la función para que filtre caducadas dinámicamente
--    Usa un CTE para calcular el mes_limite efectivo (lógica de shrink)
--    y luego descarta las que ya expiraron respecto al mes actual.
CREATE OR REPLACE FUNCTION public.obtener_recuperaciones_usuario(p_usuario_id uuid)
RETURNS TABLE(id bigint, modalidad text, mes_limite integer, anio_limite integer, mes_origen integer, anio_origen integer)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_mes_actual integer := EXTRACT(MONTH FROM CURRENT_DATE)::integer;
  v_anio_actual integer := EXTRACT(YEAR FROM CURRENT_DATE)::integer;
BEGIN
    RETURN QUERY
    WITH computed AS (
        SELECT
            r.id,
            r.modalidad,
            -- Lógica dinámica de mes_limite (shrink si ya usó cross-month)
            CASE
                WHEN r.mes_limite != r.mes_origen THEN
                    CASE
                        WHEN (
                            SELECT COUNT(*)
                            FROM recuperaciones usage
                            WHERE usage.usuario_id = r.usuario_id
                              AND usage.estado = 'usada'
                              AND usage.mes_uso = r.mes_limite
                              AND usage.anio_uso = r.anio_limite
                              AND (usage.mes_origen != usage.mes_uso OR usage.anio_origen != usage.anio_uso)
                        ) >= 1 THEN r.mes_origen
                        ELSE r.mes_limite
                    END
                ELSE r.mes_limite
            END as v_mes_limite,
            -- Lógica dinámica de anio_limite (shrink si ya usó cross-month)
            CASE
                WHEN r.mes_limite != r.mes_origen THEN
                    CASE
                        WHEN (
                            SELECT COUNT(*)
                            FROM recuperaciones usage
                            WHERE usage.usuario_id = r.usuario_id
                              AND usage.estado = 'usada'
                              AND usage.mes_uso = r.mes_limite
                              AND usage.anio_uso = r.anio_limite
                              AND (usage.mes_origen != usage.mes_uso OR usage.anio_origen != usage.anio_uso)
                        ) >= 1 THEN r.anio_origen
                        ELSE r.anio_limite
                    END
                ELSE r.anio_limite
            END as v_anio_limite,
            r.mes_origen,
            r.anio_origen
        FROM recuperaciones r
        WHERE r.usuario_id = p_usuario_id
          AND r.estado = 'disponible'
    )
    SELECT
        computed.id,
        computed.modalidad,
        computed.v_mes_limite,
        computed.v_anio_limite,
        computed.mes_origen,
        computed.anio_origen
    FROM computed
    WHERE computed.v_anio_limite > v_anio_actual
       OR (computed.v_anio_limite = v_anio_actual AND computed.v_mes_limite >= v_mes_actual)
    ORDER BY computed.v_anio_limite ASC, computed.v_mes_limite ASC;
END;
$function$;
