import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://bpzdpsmwtsmwrlyxzcsk.supabase.co';
const supabaseKey = '***REMOVED_SUPABASE_KEY***';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkOverbooking() {
    console.log('🔍 Buscando sesiones con overbooking...\n');

    // 1. Obtener todas las sesiones futuras o actuales (para no revisar histórico antiguo si no es necesario, aunque el usuario dijo "revisa todos")
    // Revisaremos desde el principio de 2024 para estar seguros, o todas.

    // Consulta: Sesiones con sus reservas activas
    const { data: sesiones, error } = await supabase
        .from('sesiones')
        .select(`
            id,
            fecha,
            hora,
            modalidad,
            capacidad,
            reservas (
                id,
                creada_en
            )
        `)
        .eq('reservas.estado', 'activa') // Solo contar activas
        .order('fecha', { ascending: true });

    if (error) {
        console.error('Error fetching sesiones:', error);
        return;
    }

    let overbookedCount = 0;

    console.log('ID | Fecha      | Hora  | Modalidad | Capacidad | Reservas | Diff');
    console.log('---|------------|-------|-----------|-----------|----------|-----');

    for (const s of sesiones) {
        // Reservas activas reales (filtrar nulls si left join, aunque aquí inner join filter aplica a reservas. wait. supabase select filter applies to relation if !inner?
        // Actually .eq('reservas.estado', 'activa') on a split query might filter parent rows if using !inner.
        // Better logic: Get session and count manually in js or use specific rpc.
        // Let's filter in JS to be safe with the exact count.

        const reservasActivas = s.reservas ? s.reservas.filter(r => true) : []; // Supabase returns filtered array

        if (reservasActivas.length > s.capacidad) {
            overbookedCount++;
            const diff = reservasActivas.length - s.capacidad;
            console.log(`${s.id.toString().padEnd(3)}| ${s.fecha} | ${s.hora.substring(0, 5)} | ${s.modalidad.padEnd(9)} | ${s.capacidad.toString().padEnd(9)} | ${reservasActivas.length.toString().padEnd(8)} | +${diff}`);
        }
    }

    console.log(`\nTotal sesiones con overbooking: ${overbookedCount}`);
}

checkOverbooking();
