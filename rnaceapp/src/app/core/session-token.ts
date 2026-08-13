// src/app/core/session-token.ts
//
// Utilidades de la sesión propia de RNACE (la app no usa Supabase Auth).
//
// Están fuera de AuthService a propósito: PushNotificationService necesita saber
// si el token es válido ANTES de que AuthService acabe de construirse. Los
// campos de una clase se inicializan antes que el cuerpo del constructor, así
// que el servicio de push se crea antes de que AuthService haya validado la
// sesión guardada. Sin esta comprobación, el push se inicializaba con un usuario
// obsoleto y después todas sus escrituras morían con un 401 silencioso.

/** Clave del access token JWT propio. */
export const SESSION_TOKEN_KEY = 'rnace_token';
/** Clave del usuario cacheado (id, nombre, rol, ...). */
export const SESSION_USER_KEY = 'rnace_usuario';
/** Marca del motivo por el que se cerró la sesión, para poder avisar en /login. */
export const SESSION_END_REASON_KEY = 'rnace_sesion_fin';
/** Momento de la última renovación con éxito (para el throttle). */
export const SESSION_LAST_REFRESH_KEY = 'rnace_sesion_renovada';

export type MotivoFinSesion = 'caducada' | 'desactivada';

/**
 * Margen de seguridad: consideramos caducado un token al que le quedan menos de
 * 30 s, para no dejar pasar una petición que expiraría a mitad de camino.
 */
const MARGEN_CADUCIDAD_MS = 30_000;

function almacenamientoDisponible(): boolean {
  return typeof localStorage !== 'undefined';
}

/**
 * Comprueba el campo `exp` del JWT. No valida la firma — eso lo hace el
 * servidor; aquí solo evitamos arrastrar una sesión que ya sabemos muerta.
 */
export function tokenCaducado(token: string): boolean {
  try {
    const [, payloadB64] = token.split('.');
    if (!payloadB64) return true;

    // Base64URL → Base64 estándar para atob().
    const base64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
    const payload = JSON.parse(atob(base64 + padding)) as { exp?: number };

    if (typeof payload.exp !== 'number') return true;
    // `exp` viene en segundos UNIX.
    return payload.exp * 1000 <= Date.now() + MARGEN_CADUCIDAD_MS;
  } catch {
    return true;
  }
}

/** Devuelve el token tal cual esté guardado, sin comprobar la caducidad. */
export function leerToken(): string | null {
  if (!almacenamientoDisponible()) return null;
  return localStorage.getItem(SESSION_TOKEN_KEY);
}

/** Devuelve el token solo si existe y no ha caducado; si no, `null`. */
export function leerTokenValido(): string | null {
  const token = leerToken();
  if (!token || tokenCaducado(token)) return null;
  return token;
}

/** Id del usuario cacheado, o `null` si no hay sesión guardada. */
export function leerUsuarioIdGuardado(): string | null {
  if (!almacenamientoDisponible()) return null;
  try {
    const guardado = localStorage.getItem(SESSION_USER_KEY);
    if (!guardado) return null;
    return (JSON.parse(guardado) as { id?: string }).id || null;
  } catch {
    return null;
  }
}

/**
 * `true` solo si hay usuario cacheado Y un token que aún sirve. Es la condición
 * que debe usarse antes de tocar OneSignal o cualquier Edge Function.
 */
export function haySesionUtilizable(): boolean {
  return leerUsuarioIdGuardado() !== null && leerTokenValido() !== null;
}
