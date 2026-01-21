-- Trigger para bloquear notificaciones a usuarios inactivos
-- Esto asegura que ninguna notificación (manual o automática) se guarde para usuarios inactivos
-- Ejecutar en Supabase SQL Editor

CREATE OR REPLACE FUNCTION public.impedir_notificacion_usuarios_inactivos()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Verificar si el usuario está inactivo
    -- Asumimos que la tabla es 'usuarios' y tiene columna 'activo'
    IF EXISTS (
        SELECT 1 
        FROM usuarios 
        WHERE id = NEW.usuario_id 
        AND activo = false
    ) THEN
        -- Si está inactivo, retornamos NULL para cancelar la inserción silenciosamente
        -- Esto evita que se guarde en el historial y dispara una señal de "skip"
        RETURN NULL;
    END IF;

    -- Si está activo, permitimos la inserción
    RETURN NEW;
END;
$$;

-- Eliminar trigger si existe para recrearlo limpio
DROP TRIGGER IF EXISTS trigger_notificacion_usuarios_activos ON public.notificaciones;

-- Crear el trigger
CREATE TRIGGER trigger_notificacion_usuarios_activos
BEFORE INSERT ON public.notificaciones
FOR EACH ROW
EXECUTE FUNCTION public.impedir_notificacion_usuarios_inactivos();

-- NOTA: Para las notificaciones Push, también se ha actualizado la Edge Function 'send-push'
-- para verificar el estado del usuario antes de enviar el mensaje.
