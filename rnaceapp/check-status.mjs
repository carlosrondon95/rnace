import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://bpzdpsmwtsmwrlyxzcsk.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwemRwc213dHNtd3JseXh6Y3NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNTg0MDIsImV4cCI6MjA3NzkzNDQwMn0.ePJ7dYKZz5OllcKxH--1T6N97zKSQS6DZ9ZJ_mljp88';
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    const { count: usuarios } = await supabase.from('usuarios').select('*', { count: 'exact', head: true }).eq('rol', 'cliente');
    const { count: planes } = await supabase.from('plan_usuario').select('*', { count: 'exact', head: true });
    const { count: reservas } = await supabase.from('reservas').select('*', { count: 'exact', head: true });

    console.log(`--- ESTADO ACTUAL ---`);
    console.log(`Usuarios Clientes: ${usuarios}`);
    console.log(`Planes asignados: ${planes}`);
    console.log(`Reservas totales: ${reservas}`);

    if (planes < 10) {
        console.log('STATUS: INCOMPLETE');
    } else {
        console.log('STATUS: OK');
    }
    process.exit(0);
}

main().catch(console.error);
