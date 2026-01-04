import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://bpzdpsmwtsmwrlyxzcsk.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwemRwc213dHNtd3JseXh6Y3NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNTg0MDIsImV4cCI6MjA3NzkzNDQwMn0.ePJ7dYKZz5OllcKxH--1T6N97zKSQS6DZ9ZJ_mljp88';
const supabase = createClient(supabaseUrl, supabaseKey);

// LÍMITES ESTRICTOS
const CAPACIDAD_FOCUS = 3;
const CAPACIDAD_REDUCIDO = 8;

async function main() {
    console.log('🚀 LIMPIEZA Y REPOBLACIÓN ESTRICTA');
    console.log(`   Focus: máx ${CAPACIDAD_FOCUS} personas`);
    console.log(`   Reducido: máx ${CAPACIDAD_REDUCIDO} personas\n`);

    // 1. OBTENER CLIENTES
    const { data: clientes } = await supabase
        .from('usuarios')
        .select('id')
        .eq('rol', 'cliente')
        .eq('activo', true);

    const clienteIds = clientes.map(c => c.id);
    console.log(`👥 ${clienteIds.length} clientes encontrados.`);

    // 2. LIMPIAR TODO (reservas, horarios fijos, planes)
    console.log('🧹 Limpiando datos existentes...');
    await supabase.from('reservas').delete().in('usuario_id', clienteIds);
    await supabase.from('lista_espera').delete().in('usuario_id', clienteIds);
    await supabase.from('horario_fijo_usuario').delete().in('usuario_id', clienteIds);
    await supabase.from('plan_usuario').delete().in('usuario_id', clienteIds);
    console.log('   ✅ Datos limpiados.\n');

    // 3. OBTENER HORARIOS BASE Y SESIONES FUTURAS
    const { data: horariosBase } = await supabase
        .from('horarios_disponibles')
        .select('*')
        .eq('activo', true);

    const hoy = new Date().toISOString().split('T')[0];
    const { data: sesiones } = await supabase
        .from('sesiones')
        .select('id, fecha, hora, modalidad, capacidad')
        .gte('fecha', hoy)
        .eq('cancelada', false);

    console.log(`📅 ${horariosBase.length} horarios base, ${sesiones.length} sesiones futuras.\n`);

    // 4. CREAR MAPA DE OCUPACIÓN (en memoria)
    // Map<sesionId, ocupaciónActual>
    const ocupacion = new Map();
    sesiones.forEach(s => ocupacion.set(s.id, 0));

    // Función para obtener capacidad de una sesión
    const getCapacidad = (sesion) => {
        if (sesion.capacidad) return sesion.capacidad;
        return sesion.modalidad === 'focus' ? CAPACIDAD_FOCUS : CAPACIDAD_REDUCIDO;
    };

    // Mapa de horario base -> sesiones correspondientes
    // key: "diaSemana-hora-modalidad"
    const sesionesDeHorario = new Map();
    sesiones.forEach(s => {
        const d = new Date(s.fecha);
        const diaSemana = d.getDay() === 0 ? 7 : d.getDay(); // Lunes=1, Domingo=7
        const key = `${diaSemana}-${s.hora.slice(0, 5)}-${s.modalidad}`;
        if (!sesionesDeHorario.has(key)) sesionesDeHorario.set(key, []);
        sesionesDeHorario.get(key).push(s);
    });

    // 5. ASIGNAR PLANES Y CREAR RESERVAS
    console.log('🔄 Asignando planes y reservas...');

    // Barajar clientes para distribución aleatoria
    const clientesBarajados = [...clientes].sort(() => Math.random() - 0.5);

    let totalReservas = 0;
    let rechazadasPorCapacidad = 0;

    for (let i = 0; i < clientesBarajados.length; i++) {
        const cliente = clientesBarajados[i];

        // Determinar tipo de plan
        const rand = Math.random();
        let tipoGrupo, clasesFocus, clasesReducido;

        if (rand < 0.4) {
            tipoGrupo = 'focus';
            clasesFocus = 2;
            clasesReducido = 0;
        } else if (rand < 0.8) {
            tipoGrupo = 'reducido';
            clasesFocus = 0;
            clasesReducido = 2;
        } else {
            tipoGrupo = 'hibrido';
            const subrand = Math.random();
            if (subrand < 0.25) { clasesFocus = 1; clasesReducido = 1; }
            else if (subrand < 0.5) { clasesFocus = 1; clasesReducido = 2; }
            else if (subrand < 0.75) { clasesFocus = 2; clasesReducido = 1; }
            else { clasesFocus = 2; clasesReducido = 2; }
        }

        // Insertar plan
        await supabase.from('plan_usuario').insert({
            usuario_id: cliente.id,
            tipo_grupo: tipoGrupo,
            clases_focus: clasesFocus,
            clases_reducido: clasesReducido,
            clases_por_mes: 0,
            activo: true
        });

        // Buscar horarios para asignar
        const horariosABuscar = [];
        for (let f = 0; f < clasesFocus; f++) horariosABuscar.push('focus');
        for (let r = 0; r < clasesReducido; r++) horariosABuscar.push('reducido');

        // Barajar horarios base para variedad
        const horariosDisponibles = [...horariosBase].sort(() => Math.random() - 0.5);

        for (const modalidadBuscada of horariosABuscar) {
            // Buscar un horario de esa modalidad
            const horario = horariosDisponibles.find(h => h.modalidad === modalidadBuscada);

            if (!horario) continue;

            // Registrar horario fijo
            await supabase.from('horario_fijo_usuario').insert({
                usuario_id: cliente.id,
                horario_disponible_id: horario.id,
                activo: true
            });

            // Crear reservas para las sesiones de ese horario
            const key = `${horario.dia_semana}-${horario.hora.slice(0, 5)}-${horario.modalidad}`;
            const sesionesFuturas = sesionesDeHorario.get(key) || [];

            for (const sesion of sesionesFuturas) {
                const ocupadas = ocupacion.get(sesion.id);
                const capacidad = getCapacidad(sesion);

                // SOLO RESERVAR SI HAY ESPACIO
                if (ocupadas < capacidad) {
                    await supabase.from('reservas').insert({
                        usuario_id: cliente.id,
                        sesion_id: sesion.id,
                        estado: 'activa',
                        es_recuperacion: false,
                        es_desde_horario_fijo: true
                    });
                    ocupacion.set(sesion.id, ocupadas + 1);
                    totalReservas++;
                } else {
                    rechazadasPorCapacidad++;
                }
            }
        }

        if ((i + 1) % 20 === 0) {
            console.log(`   Procesados ${i + 1}/${clientesBarajados.length} usuarios...`);
        }
    }

    console.log(`\n✅ RESUMEN:`);
    console.log(`   Reservas creadas: ${totalReservas}`);
    console.log(`   Rechazadas por capacidad: ${rechazadasPorCapacidad}`);

    // 6. VERIFICACIÓN FINAL
    console.log('\n🔍 Verificando límites de capacidad...');
    let errores = 0;
    for (const sesion of sesiones) {
        const ocupadas = ocupacion.get(sesion.id);
        const capacidad = getCapacidad(sesion);
        if (ocupadas > capacidad) {
            console.log(`   ❌ Sesión ${sesion.id} (${sesion.modalidad}): ${ocupadas}/${capacidad}`);
            errores++;
        }
    }

    if (errores === 0) {
        console.log('   ✅ Todas las sesiones respetan los límites de capacidad.');
    } else {
        console.log(`   ⚠️ ${errores} sesiones exceden capacidad.`);
    }

    console.log('\n🏁 Proceso finalizado.');
    process.exit(0);
}

main().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
