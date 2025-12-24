
import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import * as bcrypt from 'bcrypt';
import { create, getNumericDate } from 'djwt';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const JWT_SECRET = Deno.env.get('JWT_SECRET')!; // Changed to avoid CLI restriction

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
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
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    // 2. Verify Password - usar compareSync porque Deno Deploy no soporta Workers
    const passwordValida = bcrypt.compareSync(password, usuario.password_hash);

    if (!passwordValida) {
      return new Response(
        JSON.stringify({ success: false, error: 'Usuario o contraseña incorrectos' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    // 3. Mint JWT Token
    // We create a token that looks like a Supabase Auth token
    const payload = {
      aud: 'authenticated',
      exp: getNumericDate(60 * 60 * 24 * 7), // 1 week
      sub: usuario.id,
      email: `${telefonoLimpio}@rnace.app`, // Dummy email
      phone: telefonoLimpio,
      role: 'authenticated',
      app_metadata: {
        provider: 'phone',
        providers: ['phone'],
        rol: usuario.rol // Move role here for security
      },
      user_metadata: {
        nombre: usuario.nombre
      }
    };

    // Need Key in CryptoKey format for djwt
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(JWT_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );

    const token = await create({ alg: "HS256", typ: "JWT" }, payload, key);

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
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
