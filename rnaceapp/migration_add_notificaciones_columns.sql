-- Migración: Añadir columnas faltantes a tabla notificaciones
-- Fecha: 2026-01-12
-- Descripción: Añade las columnas sesion_id y accion_url que requiere el trigger de lista de espera

-- 1. Añadir columna sesion_id (referencia a sesión, nullable)
ALTER TABLE public.notificaciones 
ADD COLUMN IF NOT EXISTS sesion_id BIGINT REFERENCES public.sesiones(id) ON DELETE SET NULL;

-- 2. Añadir columna accion_url (para deep linking desde notificaciones)
ALTER TABLE public.notificaciones 
ADD COLUMN IF NOT EXISTS accion_url TEXT;

-- 3. Crear índice para consultas por sesion_id
CREATE INDEX IF NOT EXISTS idx_notificaciones_sesion_id ON public.notificaciones(sesion_id);

-- IMPORTANTE: Ejecuta este script en el SQL Editor de Supabase
-- Después de ejecutarlo, vuelve a probar la cancelación
