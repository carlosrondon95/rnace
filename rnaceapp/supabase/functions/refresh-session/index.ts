// Renovación silenciosa de la sesión.
//
// El cliente llama a esta función cada vez que abre la app. Mientras el token
// actual siga siendo verificable, se le devuelve uno nuevo, de modo que a un
// cliente que use la app no se le pide nunca más la contraseña.
//
// Como aquí se vuelve a leer la fila de `usuarios`, la renovación es además el
// punto donde se aplican de verdad los cambios del admin: desactivar a alguien
// le corta la sesión en la siguiente apertura, y un cambio de rol se propaga sin
// necesidad de que vuelva a entrar.
//
// IMPORTANTE sobre los códigos de respuesta: el cliente solo cierra la sesión
// ante un 401 (rechazo confirmado). Cualquier otro fallo debe devolver 5xx para
// que el cliente conserve su token y reintente más tarde; si no, un cliente sin
// cobertura quedaría expulsado, que es justo el problema que venimos a arreglar.

import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import { verify } from 'djwt';
import { corsHeaders } from '../_shared/cors.ts';
import { mintAccessToken } from '../_shared/mint-token.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const JWT_SECRET = Deno.env.get('JWT_SECRET')!;

serve(async (req: Request) => {
  const cors = corsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  try {
    const token = req.headers.get('x-rnace-token') || '';

    if (!token) {
      return json({ success: false, error: 'Token requerido' }, 401);
    }

    // 1. Verificar la firma del token actual.
    //    `verify` de djwt comprueba también el `exp`, así que un token que ya
    //    superó la ventana de renovación se rechaza aquí: pasado ese punto el
    //    cliente tiene que volver a introducir sus credenciales.
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    let payload: Record<string, unknown>;
    try {
      payload = await verify(token, key);
    } catch {
      return json({ success: false, error: 'Token invalido' }, 401);
    }

    if (typeof payload.sub !== 'string' || !payload.sub) {
      return json({ success: false, error: 'Token invalido' }, 401);
    }

    // 2. Releer el usuario con service role. El rol y el estado no se toman del
    //    token viejo: se releen de la base de datos en cada renovación.
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: usuario, error } = await supabase
      .from('usuarios')
      .select('id, telefono, nombre, rol, activo')
      .eq('id', payload.sub)
      .single();

    if (error || !usuario) {
      // Usuario borrado: rechazo confirmado, el cliente debe cerrar sesión.
      return json({ success: false, error: 'Cuenta no encontrada' }, 401);
    }

    if (!usuario.activo) {
      return json({ success: false, error: 'Cuenta desactivada' }, 401);
    }

    // 3. Emitir el token nuevo con la misma forma y vida que en `login`.
    const accessToken = await mintAccessToken(usuario, JWT_SECRET);

    return json({
      success: true,
      access_token: accessToken,
      user: {
        id: usuario.id,
        nombre: usuario.nombre,
        rol: usuario.rol,
        telefono: usuario.telefono,
      },
    });
  } catch (error: unknown) {
    // Fallo inesperado: 500 a propósito, para que el cliente NO cierre sesión.
    console.error('[refresh-session] Error inesperado:', error);
    return json({ success: false, error: 'Error interno' }, 500);
  }
});
