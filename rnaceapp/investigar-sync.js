// Script para investigar por qué no se crean sesiones para el horario 04:10
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://bpzdpsmwtsmwrlyxzcsk.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwemRwc213dHNtd3JseXh6Y3NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNTg0MDIsImV4cCI6MjA3NzkzNDQwMn0.ePJ7dYKZz5OllcKxH--1T6N97zKSQS6DZ9ZJ_mljp88';

const supabase = createClient(supabaseUrl, supabaseKey);

async function verificar() {
    console.log('=== VERIFICANDO SINCRONIZACIÓN DE HORARIO 04:10 ===\n');

    // 1. Obtener el horario 04:10 viernes
    const { data: horario } = await supabase
        .from('horarios_disponibles')
        .select('*')
        .eq('hora', '04:10:00')
        .single();

    if (horario) {
        console.log('Horario encontrado:');
        console.log(`  ID: ${horario.id}`);
        console.log(`  dia_semana: ${horario.dia_semana}`);
        console.log(`  hora: ${horario.hora}`);
        console.log(`  modalidad: ${horario.modalidad}`);
        console.log(`  activo: ${horario.activo}`);
        console.log('');
    }

    // 2. Obtener meses abiertos
    const { data: mesesAbiertos } = await supabase
        .from('agenda_mes')
        .select('*')
        .eq('abierto', true);

    console.log(`Meses abiertos: ${mesesAbiertos?.length || 0}`);
    mesesAbiertos?.forEach(m => {
        console.log(`  ${m.anio}-${String(m.mes).padStart(2, '0')}`);
    });
    console.log('');

    // 3. Simular la lógica que debería crear sesiones para viernes (dia_semana = 5)
    console.log('=== SIMULANDO LÓGICA DE SINCRONIZACIÓN ===\n');

    const fechaActual = new Date();
    fechaActual.setHours(0, 0, 0, 0);

    const diasSemana = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

    for (const mesAgenda of (mesesAbiertos || [])) {
        const anio = mesAgenda.anio;
        const mes = mesAgenda.mes;

        console.log(`Mes ${anio}-${String(mes).padStart(2, '0')}:`);

        const primerDia = new Date(anio, mes - 1, 1);
        const ultimoDia = new Date(anio, mes, 0);

        // Buscar los viernes de este mes
        let countViernes = 0;
        let viernesFuturos = 0;

        for (let d = new Date(primerDia); d <= ultimoDia; d.setDate(d.getDate() + 1)) {
            const jsDay = d.getDay(); // 0=Dom, 1=Lun... 5=Vie

            // La lógica del código compara: d.getDay() === horario.dia_semana
            // horario.dia_semana = 5 (Viernes en BD: 1=Lun...5=Vie)
            // Pero d.getDay() = 5 también es Viernes
            // Por tanto para Viernes sí debería coincidir

            if (jsDay === 5) { // Viernes
                countViernes++;
                const esFuturo = d >= fechaActual;
                if (esFuturo) viernesFuturos++;
                //console.log(`  ${d.toISOString().split('T')[0]} - ${diasSemana[jsDay]} - getDay=${jsDay} vs dia_semana=${horario?.dia_semana} - futuro=${esFuturo}`);
            }
        }
        console.log(`  Total viernes: ${countViernes}, Futuros (desde hoy): ${viernesFuturos}`);

        // El problema... ¡LA COMPARACIÓN ESTÁ MAL!
        // La sincronización compara: if (d.getDay() === horario.dia_semana)
        // Pero getDay() devuelve 0=Dom, 1=Lun... así que 5 = VIERNES
        // Y horario.dia_semana = 5 = VIERNES en el sistema 1=Lun...5=Vie
        // ENTONCES DEBÍAN COINCIDIR!!!
    }

    // 4. Verificar si hay sesiones ya existentes para esa hora+dia
    console.log('\n=== SESIONES EXISTENTES A LAS 04:10 (CUALQUIER DÍA) ===');
    const { data: sesionesPrimero } = await supabase
        .from('sesiones')
        .select('*')
        .eq('hora', '04:10:00');

    console.log(`Sesiones encontradas a las 04:10: ${sesionesPrimero?.length || 0}`);
    if (sesionesPrimero && sesionesPrimero.length > 0) {
        sesionesPrimero.slice(0, 5).forEach(s => {
            console.log(`  ${s.fecha} ${s.hora} - ${s.modalidad}`);
        });
    }

    // 5. Ver el insert de sesiones de la última sincronización (si lo hay en logs)
    console.log('\n=== DIAGNÓSTICO ===');
    console.log('Parece que la sincronización NO se ejecutó correctamente cuando se creó el horario.');
    console.log('Posibles causas:');
    console.log('1. Error en la función sincronizarHorarioConSesiones');
    console.log('2. La función no se llamó después de crear el horario');
    console.log('3. Meses abiertos no existían cuando se creó el horario');
    console.log('');
    console.log('SOLUCIÓN: Regenerar sesiones manualmente o agregar trigger en BD');
}

verificar().catch(console.error);
