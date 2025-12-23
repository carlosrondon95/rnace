-- =====================================================
-- MIGRACIÓN: Función para eliminar notificaciones
-- =====================================================

CREATE OR REPLACE FUNCTION eliminar_notificacion(
  p_notificacion_id BIGINT
)
RETURNS TABLE (ok BOOLEAN, mensaje TEXT)
LANGUAGE plpgsql
SECURITY DEFINER -- Se ejecuta con permisos de definidor para asegurar borrado si RLS es estricto
AS $func$
DECLARE
  v_usuario_id UUID;
BEGIN
  -- Verificar que la notificación pertenece al usuario actual
  SELECT usuario_id INTO v_usuario_id
  FROM notificaciones
  WHERE id = p_notificacion_id;

  IF v_usuario_id IS NULL THEN
    RETURN QUERY SELECT false, 'Notificación no encontrada.';
    RETURN;
  END IF;

  IF v_usuario_id != auth.uid() THEN
    RETURN QUERY SELECT false, 'No tienes permiso para eliminar esta notificación.';
    RETURN;
  END IF;

  -- Borrar notificación
  DELETE FROM notificaciones
  WHERE id = p_notificacion_id;

  RETURN QUERY SELECT true, 'Notificación eliminada.';
END;
$func$;
