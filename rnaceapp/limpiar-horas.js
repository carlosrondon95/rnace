// Script para LIMPIAR las reservas incorrectas del usuario Carlos Rondón Pérez
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://bpzdpsmwtsmwrlyxzcsk.supabase.co';
const supabaseKey = '***REMOVED_SUPABASE_KEY***';

const supabase = createClient(supabaseUrl, supabaseKey);

const userId = 'b3f22f81-bb5b-4717-9344-db41078ace95';

async function limpiar() {
    console.log('=== LIMPIANDO RESERVAS INCORRECTAS DE CARLOS RONDÓN PÉREZ ===\n');

    // 1. Obtener TODAS las reservas activas
    const { data: reservas } = await supabase
        .from('reservas')
        .select(`
      id,
      estado,
      sesion_id,
      sesiones (
        id, fecha, hora, modalidad
      )
    `)
        .eq('usuario_id', userId)
        .eq('estado', 'activa');

    console.log('Total reservas activas:', reservas?.length || 0);

    if (!reservas || reservas.length === 0) return;

    // 2. Identificar reservas incorrectas (Martes, Jueves o Reducido)
    const idsAEliminar = [];

    reservas.forEach(r => {
        const s = Array.isArray(r.sesiones) ? r.sesiones[0] : r.sesiones;
        if (!s) return;

        const fecha = new Date(s.fecha);
        const dia = fecha.getDay(); // 0=Dom ... 6=Sab

        // Martes=2, Jueves=4
        const esDiaIncorrecto = dia === 2 || dia === 4;
        const esModalidadIncorrecta = s.modalidad === 'reducido';

        if (esDiaIncorrecto || esModalidadIncorrecta) {
            idsAEliminar.push(r.id);

            const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
            console.log(`  MARCADA PARA BORRAR: ${s.fecha} (${diasSemana[dia]}) ${s.hora} - ${s.modalidad}`);
        }
    });

    console.log(`\nTotal a eliminar: ${idsAEliminar.length}`);

    if (idsAEliminar.length > 0) {
        // 3. Eliminar
        const { error } = await supabase
            .from('reservas')
            .delete()
            .in('id', idsAEliminar);

        if (error) {
            console.error('Error eliminando:', error);
        } else {
            console.log('✅ Reservas eliminadas correctamente.');
        }
    } else {
        console.log('No hay reservas para eliminar.');
    }
}

limpiar().catch(console.error);
