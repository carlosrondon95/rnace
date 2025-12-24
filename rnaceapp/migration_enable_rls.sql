-- ALERTA: Ejecuta esto SOLO después de verificar que el Login funciona correctamente.

-- 1. Habilitar RLS en todas las tablas sensibles
ALTER TABLE "public"."usuarios" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."plan_usuario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."reservas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."lista_espera" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."notificaciones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."fcm_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."agenda_mes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."horario_fijo_usuario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."horarios_disponibles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."sesiones" ENABLE ROW LEVEL SECURITY;

-- 2. Definir Políticas (Policies)

-- Helper para administradores
-- (Asumimos que el token JWT tiene user_metadata->rol = 'admin')

-- === TABLA: USUARIOS ===
-- Los usuarios pueden ver su propio perfil
CREATE POLICY "Usuarios ven su propio perfil" ON "public"."usuarios"
FOR SELECT TO authenticated
USING (auth.uid() = id);

-- Los administradores pueden hacer TODO en usuarios
CREATE POLICY "Admin gestiona usuarios" ON "public"."usuarios"
FOR ALL TO authenticated
USING ((auth.jwt() -> 'user_metadata' ->> 'rol') = 'admin');

-- === TABLA: RESERVAS ===
-- Usuarios ven sus propias reservas
CREATE POLICY "Usuarios ven sus reservas" ON "public"."reservas"
FOR SELECT TO authenticated
USING (auth.uid() = usuario_id);

-- Admin ve y gestiona todas las reservas
CREATE POLICY "Admin gestiona reservas" ON "public"."reservas"
FOR ALL TO authenticated
USING ((auth.jwt() -> 'user_metadata' ->> 'rol') = 'admin');

-- === TABLA: SESIONES ===
-- Todos los autenticados pueden ver las sesiones (para el calendario)
CREATE POLICY "Publico autenticado ve sesiones" ON "public"."sesiones"
FOR SELECT TO authenticated
USING (true);

-- Solo admin modifica sesiones
CREATE POLICY "Admin gestiona sesiones" ON "public"."sesiones"
FOR ALL TO authenticated
USING ((auth.jwt() -> 'user_metadata' ->> 'rol') = 'admin');

-- === TABLA: PLAN_USUARIO ===
-- Ver propio plan
CREATE POLICY "Usuarios ven su plan" ON "public"."plan_usuario"
FOR SELECT TO authenticated
USING (auth.uid() = usuario_id);

-- Admin gestiona planes
CREATE POLICY "Admin gestiona planes" ON "public"."plan_usuario"
FOR ALL TO authenticated
USING ((auth.jwt() -> 'user_metadata' ->> 'rol') = 'admin');

-- === TABLA: NOTIFICACIONES ===
-- Ver propias notificaciones
CREATE POLICY "Usuarios ven sus notificaciones" ON "public"."notificaciones"
FOR SELECT TO authenticated
USING (auth.uid() = usuario_id);

-- Admin puede crear notificaciones (si fuera necesario insertar directo)
CREATE POLICY "Admin crea notificaciones" ON "public"."notificaciones"
FOR INSERT TO authenticated
WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'rol') = 'admin');

-- === TABLA: FCM_TOKENS ===
-- Usuarios gestionan sus propios tokens (Insertar/Borrar al login/logout)
CREATE POLICY "Usuarios gestionan sus tokens" ON "public"."fcm_tokens"
FOR ALL TO authenticated
USING (auth.uid() = user_id);

-- === TABLA: LISTA_ESPERA ===
-- Usuarios ven su estado en lista de espera
CREATE POLICY "Usuarios ven su lista espera" ON "public"."lista_espera"
FOR SELECT TO authenticated
USING (auth.uid() = usuario_id);

-- Admin gestiona lista espera
CREATE POLICY "Admin gestiona lista espera" ON "public"."lista_espera"
FOR ALL TO authenticated
USING ((auth.jwt() -> 'user_metadata' ->> 'rol') = 'admin');

-- === TABLA: AGENDA_MES ===
-- Lectura pública (para saber si el mes está abierto)
CREATE POLICY "Lectura agenda mes" ON "public"."agenda_mes"
FOR SELECT TO authenticated
USING (true);

-- Admin modifica agenda
CREATE POLICY "Admin gestiona agenda mes" ON "public"."agenda_mes"
FOR ALL TO authenticated
USING ((auth.jwt() -> 'user_metadata' ->> 'rol') = 'admin');

-- === TABLA: HORARIOS_DISPONIBLES ===
-- Lectura pública
CREATE POLICY "Lectura horarios" ON "public"."horarios_disponibles"
FOR SELECT TO authenticated
USING (true);

-- Admin modifica
CREATE POLICY "Admin gestiona horarios" ON "public"."horarios_disponibles"
FOR ALL TO authenticated
USING ((auth.jwt() -> 'user_metadata' ->> 'rol') = 'admin');

-- === TABLA: HORARIO_FIJO_USUARIO ===
-- Ver propios horarios fijos
CREATE POLICY "Usuarios ven sus horarios fijos" ON "public"."horario_fijo_usuario"
FOR SELECT TO authenticated
USING (auth.uid() = usuario_id);

-- Admin gestiona horarios fijos
CREATE POLICY "Admin gestiona horarios fijos" ON "public"."horario_fijo_usuario"
FOR ALL TO authenticated
USING ((auth.jwt() -> 'user_metadata' ->> 'rol') = 'admin');
