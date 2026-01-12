-- Script para corregir el mensaje de notificación por festivo
-- Ejecutar en el SQL Editor de Supabase

-- 1. Primero, ver las funciones que contienen "festivo" en su definición
-- (Esto es solo informativo)
SELECT proname, prosrc 
FROM pg_proc 
WHERE prosrc ILIKE '%festivo%' 
LIMIT 10;

-- 2. Actualizar las notificaciones existentes (quitar "para el mes siguiente")
UPDATE public.notificaciones 
SET mensaje = REPLACE(mensaje, ' para el mes siguiente', '')
WHERE tipo = 'festivo' 
  AND mensaje LIKE '%para el mes siguiente%';

-- 3. Si hay un trigger que genera estas notificaciones, hay que encontrarlo y modificarlo.
-- Para ver los triggers de la tabla reservas:
SELECT tgname, tgrelid::regclass, pg_get_triggerdef(oid) 
FROM pg_trigger 
WHERE tgrelid = 'public.reservas'::regclass;

-- 4. Si la función que genera el mensaje se llama notificar_festivo o similar,
-- hay que crearla de nuevo con el mensaje correcto:

/*
CREATE OR REPLACE FUNCTION public.notificar_cancelacion_festivo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO public.notificaciones (
        usuario_id,
        tipo,
        titulo,
        mensaje,
        leida
    ) VALUES (
        NEW.usuario_id,  -- o el que corresponda
        'festivo',
        'Clase cancelada por festivo',
        'Tu clase del ' || to_char(fecha_sesion, 'DD/MM/YYYY') || ' ha sido cancelada por festivo. Se ha generado una recuperación.',
        FALSE
    );
    RETURN NEW;
END;
$$;
*/
