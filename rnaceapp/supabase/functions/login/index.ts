
import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import * as bcrypt from 'bcrypt';
import { corsHeaders } from '../_shared/cors.ts';
import { mintAccessToken } from '../_shared/mint-token.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const JWT_SECRET = Deno.env.get('JWT_SECRET')!; // Changed to avoid CLI restriction

serve(async (req: Request) => {
  const cors = corsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const { telefono, password } = await req.json();

    if (!telefono || !password) {
      throw new Error('Teléfono y contraseña son requeridos');
    }

    const telefonoLimpio = telefono.replace(/[^0-9]/g, '');

    // 1. Get user with Service Role (Bypasses RLS)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: usuario, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('telefono', telefonoLimpio)
      .eq('activo', true)
      .single();

    if (error || !usuario) {
      return new Response(
        JSON.stringify({ success: false, error: 'Usuario o contraseña incorrectos' }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    // 2. Verify Password - usar compareSync porque Deno Deploy no soporta Workers
    const passwordValida = bcrypt.compareSync(password, usuario.password_hash);

    if (!passwordValida) {
      return new Response(
        JSON.stringify({ success: false, error: 'Usuario o contraseña incorrectos' }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    // 3. Emitir el JWT.
    // La firma vive en _shared/mint-token.ts, compartida con `refresh-session`,
    // para que un token renovado sea equivalente a uno recién emitido.
    const token = await mintAccessToken(usuario, JWT_SECRET);

    return new Response(
      JSON.stringify({
        success: true,
        access_token: token,
        user: {
          id: usuario.id,
          nombre: usuario.nombre,
          rol: usuario.rol,
          telefono: usuario.telefono
        }
      }),
      { headers: { ...cors, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { headers: { ...cors, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
