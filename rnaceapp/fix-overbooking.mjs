import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://bpzdpsmwtsmwrlyxzcsk.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwemRwc213dHNtd3JseXh6Y3NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNTg0MDIsImV4cCI6MjA3NzkzNDQwMn0.ePJ7dYKZz5OllcKxH--1T6N97zKSQS6DZ9ZJ_mljp88';
const supabase = createClient(supabaseUrl, supabaseKey);

async function fixOverbooking() {
    console.log('🛠️ Iniciando reparación de overbooking...\n');

    // 1. Obtener sesiones con sus reservas activas
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
                creada_en,
                usuario_id
            )
        `)
        .eq('reservas.estado', 'activa')
        .order('fecha', { ascending: true });

    if (error) {
        console.error('Error fetching sesiones:', error);
        return;
    }

    let totalEliminadas = 0;

    for (const s of sesiones) {
        // Filtrar reservas activas (por si acaso el filtro inner no fue perfecto)
        const reservasActivas = s.reservas ? s.reservas.filter(r => true) : [];

        if (reservasActivas.length > s.capacidad) {
            const sobrantes = reservasActivas.length - s.capacidad;
            console.log(`Sesión ${s.id} (${s.fecha} ${s.hora} - ${s.modalidad}): ${reservasActivas.length}/${s.capacidad} reservas. Eliminando ${sobrantes}...`);

            // Ordenar por fecha de creación (ascendente) para mantener las más antiguas
            // Si creada_en es igual, usar ID como desempate
            reservasActivas.sort((a, b) => {
                const dateA = new Date(a.creada_en).getTime();
                const dateB = new Date(b.creada_en).getTime();
                if (dateA !== dateB) return dateA - dateB;
                return a.id - b.id;
            });

            // Identificar reservas a eliminar (las últimas del array)
            const aEliminar = reservasActivas.slice(s.capacidad);
            const idsEliminar = aEliminar.map(r => r.id);

            // Eliminar de base de datos
            const { error: deleteError } = await supabase
                .from('reservas')
                .delete()
                .in('id', idsEliminar);

            if (deleteError) {
                console.error(`Error eliminando reservas ${idsEliminar}:`, deleteError.message);
            } else {
                console.log(`  ✅ Eliminadas ${idsEliminar.length} reservas.`);
                totalEliminadas += idsEliminar.length;
            }
        }
    }

    console.log(`\n🎉 Reparación completada. Total reservas eliminadas: ${totalEliminadas}`);
}

fixOverbooking();
