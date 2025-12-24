-- ALERTA: Ejecutar este script para CORREGIR los fallos de seguridad detectados.

-- 1. CORREGIR POLÍTICAS RLS (Usar app_metadata en lugar de user_metadata)
-- Primero borramos las políticas viejas inseguras
DROP POLICY IF EXISTS "Admin gestiona usuarios" ON "public"."usuarios";
DROP POLICY IF EXISTS "Admin gestiona reservas" ON "public"."reservas";
DROP POLICY IF EXISTS "Admin gestiona sesiones" ON "public"."sesiones";
DROP POLICY IF EXISTS "Admin gestiona planes" ON "public"."plan_usuario";
DROP POLICY IF EXISTS "Admin crea notificaciones" ON "public"."notificaciones";
DROP POLICY IF EXISTS "Admin gestiona lista espera" ON "public"."lista_espera";
DROP POLICY IF EXISTS "Admin gestiona agenda mes" ON "public"."agenda_mes";
DROP POLICY IF EXISTS "Admin gestiona horarios" ON "public"."horarios_disponibles";
DROP POLICY IF EXISTS "Admin gestiona horarios fijos" ON "public"."horario_fijo_usuario";

-- Creamos las nuevas políticas seguras (app_metadata -> rol)
CREATE POLICY "Admin gestiona usuarios" ON "public"."usuarios" FOR ALL TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'rol') = 'admin');
CREATE POLICY "Admin gestiona reservas" ON "public"."reservas" FOR ALL TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'rol') = 'admin');
CREATE POLICY "Admin gestiona sesiones" ON "public"."sesiones" FOR ALL TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'rol') = 'admin');
CREATE POLICY "Admin gestiona planes" ON "public"."plan_usuario" FOR ALL TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'rol') = 'admin');
CREATE POLICY "Admin crea notificaciones" ON "public"."notificaciones" FOR INSERT TO authenticated WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'rol') = 'admin');
CREATE POLICY "Admin gestiona lista espera" ON "public"."lista_espera" FOR ALL TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'rol') = 'admin');
CREATE POLICY "Admin gestiona agenda mes" ON "public"."agenda_mes" FOR ALL TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'rol') = 'admin');
CREATE POLICY "Admin gestiona horarios" ON "public"."horarios_disponibles" FOR ALL TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'rol') = 'admin');
CREATE POLICY "Admin gestiona horarios fijos" ON "public"."horario_fijo_usuario" FOR ALL TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'rol') = 'admin');


-- 2. ASEGURAR FUNCIONES (Function Search Path Mutable)
-- Usamos un bloque anónimo para manejar funciones con el mismo nombre (sobrecargas) automáticamente sin error
DO $$
DECLARE
    func_name text;
    r RECORD;
    -- Lista de TODAS las funciones a corregir
    target_functions text[] := ARRAY[
        'enviar_aviso_general',
        'procesar_festivo',
        'cambiar_turno',
        'inicio_semana',
        'usar_recuperacion',
        'eliminar_notificacion',
        'cancelar_mi_clase',
        'apuntarse_lista_espera',
        'quitar_lista_espera',
        'obtener_mis_clases',
        'es_mes_abierto',
        'es_festivo',
        'tiene_clase_ese_dia',
        'handle_updated_at',
        'trigger_procesar_festivo',
        'dia_semana_iso',
        'asignar_clases_usuario_mes',
        'trigger_reserva_cancelada',
        'abrir_mes',
        'limpiar_recuperaciones_expiradas',
        'cancelar_clase_usuario',
        'notificar_hueco_libre',
        'agregar_lista_espera',
        'cancelar_dia_festivo',
        'trigger_validar_reserva',
        'consolidar_recuperaciones_mes',
        'generar_sesiones_mes',
        'asignar_reservas_usuario_mes',
        'inicializar_reservas_usuario',
        'generar_reservas_mes_todos',
        'puede_reservar',
        'cancelar_reserva',
        'obtener_recuperaciones_usuario',
        'notificar_hueco_disponible'
    ];
BEGIN
    FOREACH func_name IN ARRAY target_functions
    LOOP
        -- Buscamos todas las variantes (firmas) de la función en el esquema public
        FOR r IN
            SELECT oid::regprocedure as func_signature
            FROM pg_proc
            WHERE proname = func_name
              AND pronamespace = 'public'::regnamespace
        LOOP
            -- Aplicamos el search_path seguro a cada variante encontrada
            RAISE NOTICE 'Asegurando función: %', r.func_signature;
            EXECUTE format('ALTER FUNCTION %s SET search_path = public', r.func_signature);
        END LOOP;
    END LOOP;
END;
$$;

-- 3. CORREGIR VISTAS (Security Definer)
-- Cambiamos las vistas para que se ejecuten como el invocador (Security Invoker)
-- Esto permite que RLS funcione dentro de la vista
ALTER VIEW public.vista_lista_espera SET (security_invoker = true);
ALTER VIEW public.vista_clases_usuario SET (security_invoker = true);
ALTER VIEW public.vista_sesiones_disponibilidad SET (security_invoker = true);
