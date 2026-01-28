// Script para CORREGIR las sesiones mal creadas y recrearlas correctamente
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://bpzdpsmwtsmwrlyxzcsk.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwemRwc213dHNtd3JseXh6Y3NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNTg0MDIsImV4cCI6MjA3NzkzNDQwMn0.ePJ7dYKZz5OllcKxH--1T6N97zKSQS6DZ9ZJ_mljp88';

const supabase = createClient(supabaseUrl, supabaseKey);

// Función para formatear fecha SIN problemas de zona horaria
function formatearFecha(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

async function corregirSesiones() {
    console.log('=== CORRIGIENDO SESIONES MAL CREADAS ===\n');

    // 1. Primero, eliminar las sesiones a las 05:00 que están en el día incorrecto
    console.log('1. Eliminando sesiones incorrectas a las 05:00...');

    const { data: sesiones0500 } = await supabase
        .from('sesiones')
        .select('id, fecha, hora')
        .eq('hora', '05:00:00');

    console.log(`   Sesiones a las 05:00 encontradas: ${sesiones0500?.length || 0}`);

    // Verificar cuáles están en el día incorrecto
    let eliminadas = 0;
    for (const s of (sesiones0500 || [])) {
        const fecha = new Date(s.fecha + 'T12:00:00'); // Usar mediodía para evitar problemas de zona horaria
        const diaSemana = fecha.getDay(); // 0=Dom, 1=Lun... 5=Vie

        // El horario 05:00 es para viernes (getDay=5)
        if (diaSemana !== 5) {
            console.log(`   Eliminando ${s.fecha} (día=${diaSemana}, debería ser 5=Viernes)`);
            await supabase.from('sesiones').delete().eq('id', s.id);
            eliminadas++;
        }
    }
    console.log(`   Eliminadas: ${eliminadas}`);

    // 2. Ahora crear las sesiones CORRECTAMENTE
    console.log('\n2. Creando sesiones correctamente...\n');

    // Obtener el horario de viernes 05:00
    const { data: horario0500 } = await supabase
        .from('horarios_disponibles')
        .select('*')
        .eq('hora', '05:00:00')
        .eq('dia_semana', 5)
        .single();

    if (!horario0500) {
        console.log('No se encontró el horario de viernes 05:00');
        return;
    }

    console.log(`   Horario encontrado: ID=${horario0500.id}, día=${horario0500.dia_semana}, modalidad=${horario0500.modalidad}`);

    // Obtener meses abiertos
    const { data: meses } = await supabase
        .from('agenda_mes')
        .select('*')
        .eq('abierto', true);

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    let creadas = 0;

    for (const mes of (meses || [])) {
        const primerDia = new Date(mes.anio, mes.mes - 1, 1);
        const ultimoDia = new Date(mes.anio, mes.mes, 0);

        // Iterar días del mes
        for (let d = new Date(primerDia); d <= ultimoDia; d.setDate(d.getDate() + 1)) {
            const fecha = new Date(d);
            const diaSemana = fecha.getDay(); // 0=Dom, 1=Lun... 5=Vie

            // Solo viernes (getDay = 5)
            if (diaSemana !== 5) continue;

            // Solo fechas futuras
            if (fecha < hoy) continue;

            const fechaStr = formatearFecha(fecha);

            // Verificar si ya existe
            const { data: existente } = await supabase
                .from('sesiones')
                .select('id')
                .eq('fecha', fechaStr)
                .eq('hora', horario0500.hora)
                .eq('modalidad', horario0500.modalidad)
                .maybeSingle();

            if (existente) continue;

            // Crear sesión
            const { error } = await supabase
                .from('sesiones')
                .insert({
                    fecha: fechaStr,
                    hora: horario0500.hora,
                    modalidad: horario0500.modalidad,
                    capacidad: horario0500.capacidad_maxima,
                    cancelada: false
                });

            if (error) {
                console.log(`   Error creando ${fechaStr}: ${error.message}`);
            } else {
                console.log(`   + ${fechaStr} (${['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][diaSemana]}) 05:00 focus`);
                creadas++;
            }
        }
    }

    console.log(`\n   Sesiones correctas creadas: ${creadas}`);

    // 3. Verificar
    console.log('\n3. Verificación final...');

    const { data: sesionesFinales } = await supabase
        .from('sesiones')
        .select('*')
        .eq('hora', '05:00:00')
        .order('fecha');

    console.log(`   Sesiones a las 05:00: ${sesionesFinales?.length || 0}`);
    sesionesFinales?.slice(0, 10).forEach(s => {
        const fecha = new Date(s.fecha + 'T12:00:00');
        const dia = fecha.getDay();
        const diasNombre = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        console.log(`     ${s.fecha} (${diasNombre[dia]}) ${s.hora.slice(0, 5)} - ${s.modalidad}`);
    });

    // 4. Regenerar reservas
    console.log('\n4. Regenerando reservas para el usuario aaa aaa...');

    const userId = '2787188a-933a-41ec-a638-f1bfd7c7fb24';
    const { data: resultado, error } = await supabase
        .rpc('regenerar_reservas_futuras', { p_usuario_id: userId });

    if (error) {
        console.log(`   Error: ${error.message}`);
    } else {
        console.log('   Resultado:', JSON.stringify(resultado, null, 2));
    }

    // 5. Verificar reservas del usuario
    console.log('\n5. Reservas del usuario aaa aaa:');

    const { data: reservas } = await supabase
        .from('reservas')
        .select(`
            id,
            estado,
            sesiones (fecha, hora, modalidad)
        `)
        .eq('usuario_id', userId)
        .eq('estado', 'activa')
        .order('id', { ascending: false });

    // Agrupar por hora
    const porHora = {};
    reservas?.forEach(r => {
        const hora = r.sesiones?.hora?.slice(0, 5);
        if (!porHora[hora]) porHora[hora] = [];
        porHora[hora].push(r.sesiones?.fecha);
    });

    console.log(`   Total reservas activas: ${reservas?.length || 0}`);
    Object.keys(porHora).sort().forEach(hora => {
        console.log(`   ${hora}: ${porHora[hora].length} reservas`);
    });
}

corregirSesiones().catch(console.error);
