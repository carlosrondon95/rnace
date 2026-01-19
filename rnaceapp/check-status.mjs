import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://bpzdpsmwtsmwrlyxzcsk.supabase.co';
const supabaseKey = '***REMOVED_SUPABASE_KEY***';
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
