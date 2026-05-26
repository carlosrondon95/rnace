
import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import * as bcrypt from 'bcrypt';
import { verify } from 'djwt';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const JWT_SECRET = Deno.env.get('JWT_SECRET')!;

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
            return jsonResponse(403, { success: false, error: 'Solo los administradores pueden cambiar contraseñas' });
        }

        // 1. Validar inputs
        const { userId, newPassword } = await req.json();

        if (!userId || !newPassword) {
            throw new Error('userId y newPassword son requeridos');
        }

        if (newPassword.length < 6) {
            throw new Error('La contraseña debe tener al menos 6 caracteres');
        }

        // 2. Hash new password
        const salt = bcrypt.genSaltSync(10);
        const passwordHash = bcrypt.hashSync(newPassword, salt);

        // 3. Update user with Service Role (Bypasses RLS)
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        const { error } = await supabase
            .from('usuarios')
            .update({
                password_hash: passwordHash,
                actualizado_en: new Date().toISOString(),
            })
            .eq('id', userId);

        if (error) {
            console.error('Error updating password:', error);
            throw error;
        }

        return jsonResponse(200, { success: true });

    } catch (error: unknown) {
        console.error(error);
        const message = error instanceof Error ? error.message : String(error);
        return jsonResponse(400, { success: false, error: message });
    }
});
