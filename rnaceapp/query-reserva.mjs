import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://bpzdpsmwtsmwrlyxzcsk.supabase.co';
const supabaseKey = '***REMOVED_SUPABASE_KEY***';
const supabase = createClient(supabaseUrl, supabaseKey);

async function explorarEsquema() {
    console.log('🔍 Explorando estructura de tablas...\n');

    // Buscar tabla de recuperaciones
    const tablasPosibles = [
        'recuperaciones',
        'recuperaciones_usuario',
        'recuperaciones_pendientes',
        'clases_recuperacion',
        'creditos_recuperacion'
    ];

    for (const tabla of tablasPosibles) {
        const { data, error } = await supabase
            .from(tabla)
            .select('*')
            .limit(1);

        if (!error) {
            console.log(`✅ Encontrada tabla: ${tabla}`);
            console.log('   Estructura:', data);
        }
    }

    // También revisar las reservas para ver la estructura
    const { data: reserva } = await supabase
        .from('reservas')
        .select('*')
        .limit(1);

    console.log('\n📋 Estructura de reservas:', reserva);
}

explorarEsquema().then(() => process.exit(0)).catch(console.error);
