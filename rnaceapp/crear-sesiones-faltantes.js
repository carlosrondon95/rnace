// Script para CREAR las sesiones faltantes directamente
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://bpzdpsmwtsmwrlyxzcsk.supabase.co';
const supabaseKey = '***REMOVED_SUPABASE_KEY***';

const supabase = createClient(supabaseUrl, supabaseKey);

async function crearSesionesFaltantes() {
    console.log('=== CREANDO SESIONES FALTANTES ===\n');

    // 1. Obtener horarios disponibles activos
    const { data: horarios, error: errorHorarios } = await supabase
        .from('horarios_disponibles')
        .select('*')
        .eq('activo', true);

    if (errorHorarios) {
        console.error('Error obteniendo horarios:', errorHorarios);
        return;
    }

    console.log(`Horarios activos: ${horarios.length}`);

    // 2. Obtener meses abiertos
    const { data: meses, error: errorMeses } = await supabase
        .from('agenda_mes')
        .select('*')
        .eq('abierto', true);

    if (errorMeses) {
        console.error('Error obteniendo meses:', errorMeses);
        return;
    }

    console.log(`Meses abiertos: ${meses.length}`);

    // 3. Para cada mes y cada horario, crear sesiones si no existen
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    let sesionesCreadas = 0;
    let sesionesExistentes = 0;

    for (const mes of meses) {
        const primerDia = new Date(mes.anio, mes.mes - 1, 1);
        const ultimoDia = new Date(mes.anio, mes.mes, 0);

        console.log(`\nProcesando ${mes.anio}-${String(mes.mes).padStart(2, '0')}...`);

        for (const horario of horarios) {
            // Iterar cada día del mes
            for (let d = new Date(primerDia); d <= ultimoDia; d.setDate(d.getDate() + 1)) {
                const fecha = new Date(d);

                // getDay(): 0=Dom, 1=Lun, 2=Mar, 3=Mié, 4=Jue, 5=Vie, 6=Sáb
                // horario.dia_semana: 1=Lun, 2=Mar, 3=Mié, 4=Jue, 5=Vie
                // Para convertir: si getDay() es 0 (Dom) -> 7, sino getDay()
                let diaSemanaISO = fecha.getDay();
                if (diaSemanaISO === 0) diaSemanaISO = 7; // Dom -> 7

                // Solo crear si coincide el día de la semana
                if (diaSemanaISO !== horario.dia_semana) continue;

                // Solo crear para fechas futuras o de hoy
                if (fecha < hoy) continue;

                const fechaStr = fecha.toISOString().split('T')[0];

                // Verificar si ya existe
                const { data: existente } = await supabase
                    .from('sesiones')
                    .select('id')
                    .eq('fecha', fechaStr)
                    .eq('hora', horario.hora)
                    .eq('modalidad', horario.modalidad)
                    .maybeSingle();

                if (existente) {
                    sesionesExistentes++;
                    continue;
                }

                // Crear sesión
                const { error: insertError } = await supabase
                    .from('sesiones')
                    .insert({
                        fecha: fechaStr,
                        hora: horario.hora,
                        modalidad: horario.modalidad,
                        capacidad: horario.capacidad_maxima,
                        cancelada: false
                    });

                if (insertError) {
                    console.error(`Error creando sesión ${fechaStr} ${horario.hora}:`, insertError.message);
                } else {
                    console.log(`  + Creada: ${fechaStr} ${horario.hora.slice(0, 5)} ${horario.modalidad}`);
                    sesionesCreadas++;
                }
            }
        }
    }

    console.log(`\n=== RESUMEN ===`);
    console.log(`Sesiones creadas: ${sesionesCreadas}`);
    console.log(`Sesiones ya existentes: ${sesionesExistentes}`);

    // 4. Ahora regenerar reservas
    if (sesionesCreadas > 0) {
        console.log('\n=== REGENERANDO RESERVAS ===\n');

        const { data: resultado, error: regenError } = await supabase
            .rpc('regenerar_reservas_futuras');

        if (regenError) {
            console.error('Error regenerando reservas:', regenError.message);
        } else {
            console.log('Resultado:', JSON.stringify(resultado, null, 2));
        }
    }

    // 5. Verificar sesiones a las 05:00
    console.log('\n=== VERIFICACIÓN FINAL: SESIONES A LAS 05:00 ===');
    const { data: sesiones0500 } = await supabase
        .from('sesiones')
        .select('*')
        .eq('hora', '05:00:00')
        .order('fecha');

    console.log(`Sesiones a las 05:00: ${sesiones0500?.length || 0}`);
    sesiones0500?.slice(0, 10).forEach(s => {
        console.log(`  ${s.fecha} ${s.hora.slice(0, 5)} - ${s.modalidad}`);
    });

    // 6. Verificar reservas del usuario aaa aaa
    console.log('\n=== VERIFICACIÓN: RESERVAS DE aaa aaa ===');
    const { data: reservasUsuario } = await supabase
        .from('reservas')
        .select(`
            id,
            estado,
            sesiones (fecha, hora, modalidad)
        `)
        .eq('usuario_id', '2787188a-933a-41ec-a638-f1bfd7c7fb24')
        .eq('estado', 'activa')
        .order('id', { ascending: false });

    console.log(`Reservas activas: ${reservasUsuario?.length || 0}`);
    reservasUsuario?.slice(0, 20).forEach(r => {
        const s = r.sesiones;
        console.log(`  ${s?.fecha} ${s?.hora?.slice(0, 5)} - ${s?.modalidad}`);
    });
}

crearSesionesFaltantes().catch(console.error);
