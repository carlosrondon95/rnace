
import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import * as bcrypt from 'bcrypt';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const { telefono, password, nombre, rol } = await req.json();

        if (!telefono || !password) {
            throw new Error('Teléfono y contraseña son requeridos');
        }

        const telefonoLimpio = telefono.replace(/[^0-9]/g, '');

        // 1. Hash Password
        // 1. Hash Password
        // Use Sync methods because Deno Deploy/Edge Runtime does not support Workers for this library
        const salt = bcrypt.genSaltSync(10);
        const passwordHash = bcrypt.hashSync(password, salt);

        // 2. Insert User with Service Role (Bypasses RLS)
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        const { data, error } = await supabase
            .from('usuarios')
            .insert({
                telefono: telefonoLimpio,
                password_hash: passwordHash,
                nombre: nombre,
                rol: rol || 'cliente',
                activo: true
            })
            .select()
            .single();

        if (error) {
            console.error('Error inserting user:', error);
            throw error;
        }

        return new Response(
            JSON.stringify({
                success: true,
                userId: data.id,
                user: data
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
