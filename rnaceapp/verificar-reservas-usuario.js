// Script para verificar y corregir reservas del usuario aaa aaa
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://bpzdpsmwtsmwrlyxzcsk.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwemRwc213dHNtd3JseXh6Y3NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNTg0MDIsImV4cCI6MjA3NzkzNDQwMn0.ePJ7dYKZz5OllcKxH--1T6N97zKSQS6DZ9ZJ_mljp88';

const supabase = createClient(supabaseUrl, supabaseKey);

async function verificarReservas() {
    const userId = '2787188a-933a-41ec-a638-f1bfd7c7fb24'; // aaa aaa

    console.log('=== VERIFICANDO RESERVAS DE aaa aaa ===\n');

    // 1. Obtener horarios fijos del usuario
    const { data: horariosFijos } = await supabase
        .from('horario_fijo_usuario')
        .select(`
            id,
            horario_disponible_id,
            activo,
            horarios_disponibles (id, dia_semana, hora, modalidad)
        `)
        .eq('usuario_id', userId)
        .eq('activo', true);

    console.log('Horarios fijos del usuario:');
    const diasSemana = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    horariosFijos?.forEach(hf => {
        const h = hf.horarios_disponibles;
        if (h) {
            console.log(`  - dia_semana:${h.dia_semana} (${diasSemana[h.dia_semana]}) hora:${h.hora} modalidad:${h.modalidad}`);
        }
    });

    // 2. Buscar sesiones que coincidan con los horarios fijos
    console.log('\n=== BUSCANDO SESIONES COINCIDENTES ===\n');

    for (const hf of (horariosFijos || [])) {
        const h = hf.horarios_disponibles;
        if (!h) continue;

        console.log(`\nHorario: ${diasSemana[h.dia_semana]} ${h.hora?.slice(0, 5)} ${h.modalidad}`);

        // Buscar sesiones que coincidan
        const { data: sesiones } = await supabase
            .from('sesiones')
            .select('id, fecha, hora, modalidad')
            .eq('hora', h.hora)
            .eq('modalidad', h.modalidad)
            .eq('cancelada', false)
            .gte('fecha', new Date().toISOString().split('T')[0])
            .order('fecha')
            .limit(5);

        if (sesiones?.length) {
            console.log(`  Sesiones encontradas: ${sesiones.length}`);

            // Para cada sesión, verificar si coincide el día de la semana
            for (const s of sesiones) {
                const fecha = new Date(s.fecha + 'T12:00:00');
                let diaSemanaISO = fecha.getDay();
                if (diaSemanaISO === 0) diaSemanaISO = 7; // Dom -> 7

                const coincide = diaSemanaISO === h.dia_semana;

                // Verificar si tiene reserva
                const { data: reserva } = await supabase
                    .from('reservas')
                    .select('id, estado')
                    .eq('usuario_id', userId)
                    .eq('sesion_id', s.id)
                    .maybeSingle();

                console.log(`    ${s.fecha} (día=${diaSemanaISO}) ${coincide ? '✓' : '✗'} | reserva: ${reserva?.estado || 'NINGUNA'}`);
            }
        } else {
            console.log('  No hay sesiones futuras');
        }
    }

    // 3. Regenerar reservas solo para este usuario
    console.log('\n=== REGENERANDO RESERVAS PARA ESTE USUARIO ===');

    const { data: resultado, error } = await supabase
        .rpc('regenerar_reservas_futuras', { p_usuario_id: userId });

    if (error) {
        console.log('Error:', error.message);
    } else {
        console.log('Resultado:', JSON.stringify(resultado, null, 2));
    }

    // 4. Verificar reservas finales
    console.log('\n=== RESERVAS FINALES ===');

    const { data: reservasFinales } = await supabase
        .from('reservas')
        .select(`
            id,
            estado,
            sesiones (fecha, hora, modalidad)
        `)
        .eq('usuario_id', userId)
        .eq('estado', 'activa')
        .order('id', { ascending: false });

    console.log(`Total reservas activas: ${reservasFinales?.length || 0}`);

    // Agrupar por hora para ver si están las de 05:00
    const porHora = {};
    reservasFinales?.forEach(r => {
        const hora = r.sesiones?.hora?.slice(0, 5);
        if (!porHora[hora]) porHora[hora] = [];
        porHora[hora].push(r.sesiones?.fecha);
    });

    console.log('\nReservas por hora:');
    Object.keys(porHora).sort().forEach(hora => {
        console.log(`  ${hora}: ${porHora[hora].length} reservas`);
        porHora[hora].slice(0, 3).forEach(fecha => console.log(`      - ${fecha}`));
    });
}

verificarReservas().catch(console.error);
