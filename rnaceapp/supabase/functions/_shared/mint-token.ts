// Emisión centralizada del JWT propio de RNACE.
//
// La usan `login` (primera emisión, tras validar la contraseña) y
// `refresh-session` (renovación silenciosa). Está compartido a propósito: si el
// payload o la caducidad se definieran por separado en cada función, acabarían
// desincronizándose y un token renovado dejaría de ser equivalente al original.
//
// Nota sobre el import: aquí se usa la URL completa de djwt en lugar del
// especificador `djwt` del import map, porque este módulo lo importan varias
// funciones y cada una tiene su propio deno.json. Con la URL explícita resuelve
// igual desde cualquiera de ellas.
import { create, getNumericDate } from 'https://deno.land/x/djwt@v2.8/mod.ts';

/**
 * Ventana durante la que un token sigue siendo renovable.
 *
 * NO es la duración real de la sesión: `refresh-session` emite un token nuevo
 * cada vez que el cliente abre la app, así que quien la use con normalidad no
 * vuelve a ver la pantalla de login. Estos 90 días son el margen que tiene
 * alguien para volver antes de que su token deje de poder renovarse.
 */
export const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 días

export interface UsuarioToken {
  id: string;
  telefono: string;
  nombre: string | null;
  rol: string;
}

/**
 * Firma un access token para el usuario dado. El resultado imita la forma de un
 * token de Supabase Auth, pero lo emitimos y verificamos nosotros.
 */
export async function mintAccessToken(
  usuario: UsuarioToken,
  jwtSecret: string,
): Promise<string> {
  const telefonoLimpio = String(usuario.telefono || '').replace(/[^0-9]/g, '');

  const payload = {
    aud: 'authenticated',
    exp: getNumericDate(TOKEN_TTL_SECONDS),
    sub: usuario.id,
    email: `${telefonoLimpio}@rnace.app`, // Dummy email
    phone: telefonoLimpio,
    role: 'authenticated',
    app_metadata: {
      provider: 'phone',
      providers: ['phone'],
      rol: usuario.rol, // El rol vive aquí, no en user_metadata, por seguridad
    },
    user_metadata: {
      nombre: usuario.nombre,
    },
  };

  // djwt necesita la clave en formato CryptoKey
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(jwtSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );

  return await create({ alg: 'HS256', typ: 'JWT' }, payload, key);
}
