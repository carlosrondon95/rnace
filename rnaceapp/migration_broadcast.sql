-- Función RPC para enviar notificaciones a todos los usuarios activos
-- UPDATED: Acepta p_usuario_id para validar rol ya que no se usa Supabase Auth nativo
CREATE OR REPLACE FUNCTION public.enviar_aviso_general(
    p_usuario_id UUID,
    p_titulo TEXT,
    p_mensaje TEXT,
    p_tipo TEXT DEFAULT 'admin_info'
)
RETURNS TABLE (ok BOOLEAN, mensaje TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    -- 1. Verificar que el usuario proporcionado es admin
    IF NOT EXISTS (
        SELECT 1 FROM public.usuarios
        WHERE id = p_usuario_id AND rol = 'admin'
    ) THEN
        RETURN QUERY SELECT FALSE, 'No tienes permisos de administrador (ID no autorizado)';
        RETURN;
    END IF;

    -- 2. Insertar notificación para todos los usuarios activos
    INSERT INTO public.notificaciones (usuario_id, tipo, titulo, mensaje, leida, creado_en)
    SELECT 
        id, 
        p_tipo, 
        p_titulo, 
        p_mensaje, 
        FALSE, 
        NOW()
    FROM public.usuarios
    WHERE activo = TRUE;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    RETURN QUERY SELECT TRUE, 'Notificación enviada a ' || v_count::TEXT || ' usuarios.';
END;
$$;
