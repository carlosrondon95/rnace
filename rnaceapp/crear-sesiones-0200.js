// Script para crear sesiones para horario específico
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://bpzdpsmwtsmwrlyxzcsk.supabase.co';
const supabaseKey = '***REMOVED_SUPABASE_KEY***';

const supabase = createClient(supabaseUrl, supabaseKey);

function formatearFecha(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

async function main() {
    console.log('=== CREANDO SESIONES PARA HORARIO 02:00 (ID:114) ===\n');

    // El horario es ID:114
    const horario = {
        id: 114,
        dia_semana: 5, // Viernes
        hora: '02:00:00',
        modalidad: 'focus',
        capacidad_maxima: 3
    };

    // Obtener meses abiertos
    const { data: meses } = await supabase
        .from('agenda_mes')
        .select('*')
        .eq('abierto', true);

    console.log(`Meses abiertos: ${meses?.length || 0}`);

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    let creadas = 0;
    const diasNombre = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

    for (const mes of (meses || [])) {
        const primerDia = new Date(mes.anio, mes.mes - 1, 1);
        const ultimoDia = new Date(mes.anio, mes.mes, 0);

        for (let d = new Date(primerDia); d <= ultimoDia; d.setDate(d.getDate() + 1)) {
            const fecha = new Date(d);
            const diaSemana = fecha.getDay(); // 0=Dom, 5=Vie

            // Solo viernes (getDay() = 5)
            if (diaSemana !== 5) continue;

            // Solo fechas futuras
            if (fecha < hoy) continue;

            const fechaStr = formatearFecha(fecha);

            // Verificar si ya existe
            const { data: existente } = await supabase
                .from('sesiones')
                .select('id')
                .eq('fecha', fechaStr)
                .eq('hora', horario.hora)
                .eq('modalidad', horario.modalidad)
                .maybeSingle();

            if (existente) continue;

            // Crear sesión
            const { error } = await supabase
                .from('sesiones')
                .insert({
                    fecha: fechaStr,
                    hora: horario.hora,
                    modalidad: horario.modalidad,
                    capacidad: horario.capacidad_maxima,
                    cancelada: false
                });

            if (error) {
                console.log(`Error: ${error.message}`);
            } else {
                console.log(`+ ${fechaStr} (${diasNombre[diaSemana]}) 02:00 focus`);
                creadas++;
            }
        }
    }

    console.log(`\nSesiones creadas: ${creadas}`);

    // Regenerar reservas
    console.log('\n=== REGENERANDO RESERVAS ===');
    const { data: res, error } = await supabase.rpc('regenerar_reservas_futuras');
    console.log(error ? error.message : JSON.stringify(res, null, 2));

    // Verificar el último usuario creado
    console.log('\n=== ÚLTIMO USUARIO (debería ser el del horario 02:00) ===');

    const { data: usuarios } = await supabase
        .from('usuarios')
        .select('*')
        .eq('rol', 'cliente')
        .order('creado_en', { ascending: false })
        .limit(1);

    for (const u of (usuarios || [])) {
        console.log(`Usuario: ${u.nombre} (tel: ${u.telefono})`);

        // Horarios fijos
        const { data: hfsData } = await supabase
            .from('horario_fijo_usuario')
            .select(`horarios_disponibles (dia_semana, hora, modalidad)`)
            .eq('usuario_id', u.id)
            .eq('activo', true);

        console.log('Horarios fijos:');
        hfsData?.forEach(hf => {
            const h = hf.horarios_disponibles;
            if (h) console.log(`  - ${diasNombre[h.dia_semana] || 'día' + h.dia_semana} ${h.hora?.slice(0, 5)} ${h.modalidad}`);
        });

        // Reservas
        const { data: reservas } = await supabase
            .from('reservas')
            .select(`sesiones (fecha, hora)`)
            .eq('usuario_id', u.id)
            .eq('estado', 'activa');

        console.log(`Reservas activas: ${reservas?.length || 0}`);
        reservas?.slice(0, 5).forEach(r => {
            console.log(`  - ${r.sesiones?.fecha} ${r.sesiones?.hora?.slice(0, 5)}`);
        });
    }
}

main().catch(console.error);
