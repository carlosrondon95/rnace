
import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import * as bcrypt from 'bcrypt';
import { verify } from 'djwt';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const JWT_SECRET = Deno.env.get('JWT_SECRET')!;

const ROLES_VALIDOS = ['cliente', 'profesor', 'admin'] as const;

serve(async (req: Request) => {
    const cors = corsHeaders(req);

    const jsonResponse = (status: number, body: Record<string, unknown>) => new Response(
        JSON.stringify(body),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status }
    );

    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: cors });
    }

    try {
        // 0. Verificar JWT custom del invocador y que sea admin
        const rnaceToken = req.headers.get('x-rnace-token');
        if (!rnaceToken) {
            return jsonResponse(401, { success: false, error: 'No autenticado' });
        }

        const key = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(JWT_SECRET),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign', 'verify'],
        );

        let payload: Record<string, unknown>;
        try {
            payload = await verify(rnaceToken, key) as Record<string, unknown>;
        } catch {
            return jsonResponse(401, { success: false, error: 'Sesión inválida o caducada' });
        }

        const appMetadata = payload.app_metadata as { rol?: string } | undefined;
        if (appMetadata?.rol !== 'admin') {
            return jsonResponse(403, { success: false, error: 'Solo los administradores pueden crear usuarios' });
        }

        // 1. Validar inputs
        const { telefono, password, nombre, rol } = await req.json();

        if (!telefono || !password) {
            throw new Error('Teléfono y contraseña son requeridos');
        }

        const telefonoLimpio = telefono.replace(/[^0-9]/g, '');

        // Whitelist de roles: si llega cualquier otro valor, fallback a 'cliente'
        const rolFinal = ROLES_VALIDOS.includes(rol) ? rol : 'cliente';

        // 2. Hash Password
        // Use Sync methods because Deno Deploy/Edge Runtime does not support Workers for this library
        const salt = bcrypt.genSaltSync(10);
        const passwordHash = bcrypt.hashSync(password, salt);

        // 3. Insert User with Service Role (Bypasses RLS)
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        const { data, error } = await supabase
            .from('usuarios')
            .insert({
                telefono: telefonoLimpio,
                password_hash: passwordHash,
                nombre: nombre,
                rol: rolFinal,
                activo: true
            })
            .select()
            .single();

        if (error) {
            console.error('Error inserting user:', error);
            throw error;
        }

        return jsonResponse(200, {
            success: true,
            userId: data.id,
            user: data
        });

    } catch (error: unknown) {
        console.error(error);
        const message = error instanceof Error ? error.message : String(error);
        return jsonResponse(400, { success: false, error: message });
    }
});
