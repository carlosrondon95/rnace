import { createClient } from '@supabase/supabase-js';

// Configuración
const supabaseUrl = 'https://bpzdpsmwtsmwrlyxzcsk.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwemRwc213dHNtd3JseXh6Y3NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNTg0MDIsImV4cCI6MjA3NzkzNDQwMn0.ePJ7dYKZz5OllcKxH--1T6N97zKSQS6DZ9ZJ_mljp88';
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    console.log('🚀 Iniciando asignación masiva de grupos y horarios...');

    // 1. Obtener usuarios clientes
    const { data: usuarios, error: errUsu } = await supabase
        .from('usuarios')
        .select('id, nombre')
        .eq('rol', 'cliente')
        .eq('activo', true);

    if (errUsu) throw errUsu;
    console.log(`👥 Encontrados ${usuarios.length} clientes activos.`);

    // 2. Obtener horarios disponibles
    const { data: horarios, error: errHor } = await supabase
        .from('horarios_disponibles')
        .select('*')
        .eq('activo', true);

    if (errHor) throw errHor;
    console.log(`📅 Encontrados ${horarios.length} slots de horarios base.`);

    // 3. Obtener sesiones futuras
    const hoy = new Date().toISOString().split('T')[0];
    const { data: sesiones, error: errSes } = await supabase
        .from('sesiones')
        .select('id, fecha, hora, modalidad')
        .gte('fecha', hoy);

    if (errSes) throw errSes;
    console.log(`🏋️  Encontradas ${sesiones.length} sesiones futuras.`);

    // Mapa para acceso rápido a sesiones
    const sesionesMap = new Map();
    sesiones.forEach(s => {
        const d = new Date(s.fecha);
        const diaSemana = d.getDay() || 7;
        const key = `${diaSemana}-${s.hora.slice(0, 5)}-${s.modalidad}`;
        if (!sesionesMap.has(key)) sesionesMap.set(key, []);
        sesionesMap.get(key).push(s);
    });

    // 4. Procesar usuarios
    let asignados = 0;
    const usuariosBarajados = [...usuarios].sort(() => Math.random() - 0.5);

    for (const usuario of usuariosBarajados) {
        try {
            // Limpiar datos previos
            await supabase.from('horario_fijo_usuario').delete().eq('usuario_id', usuario.id);
            await supabase.from('plan_usuario').delete().eq('usuario_id', usuario.id);

            // Asignar Plan Aleatorio (80% Focus)
            const tipoPlan = Math.random() > 0.2 ? 'focus' : 'reducido';
            const clasesFocus = tipoPlan === 'focus' ? 2 : 0;
            const clasesReducido = tipoPlan === 'reducido' ? 2 : 0;

            await supabase.from('plan_usuario').insert({
                usuario_id: usuario.id,
                tipo_grupo: tipoPlan,
                clases_focus: clasesFocus,
                clases_reducido: clasesReducido,
                clases_por_mes: 0,
                activo: true
            });

            // Elegir 2 horarios aleatorios
            const horariosCompatibles = horarios.filter(h => h.modalidad === tipoPlan);
            const numClases = 2;
            const horariosElegidos = horariosCompatibles.sort(() => Math.random() - 0.5).slice(0, numClases);

            for (const h of horariosElegidos) {
                // Insertar horario fijo
                await supabase.from('horario_fijo_usuario').insert({
                    usuario_id: usuario.id,
                    horario_disponible_id: h.id,
                    activo: true
                });

                // Crear reservas para ese horario
                const key = `${h.dia_semana}-${h.hora.slice(0, 5)}-${h.modalidad}`;
                const sesionesCoincidentes = sesionesMap.get(key) || [];

                for (const sesion of sesionesCoincidentes) {
                    await supabase.from('reservas').insert({
                        usuario_id: usuario.id,
                        sesion_id: sesion.id,
                        estado: 'activa',
                        es_recuperacion: false,
                        es_desde_horario_fijo: true
                    }).then(({ error }) => {
                        // Ignorar errores de duplicado o capacidad
                    });
                }
            }

            asignados++;
            if (asignados % 20 === 0) console.log(`✅ Procesados ${asignados} usuarios...`);
        } catch (e) {
            console.error(`Error procesando usuario ${usuario.id}:`, e.message);
        }
    }

    // 5. SATURACION PARA LISTA DE ESPERA
    // Elegir una sesión aleatoria de las próximas disponibles y llenarla a tope
    if (sesiones.length > 0) {
        const sesionSaturada = sesiones[Math.floor(Math.random() * Math.min(20, sesiones.length))]; // Una de las primeras 20
        console.log(`\n🔥 INTENTO DE SATURACIÓN: Sesión del ${sesionSaturada.fecha} a las ${sesionSaturada.hora} (${sesionSaturada.modalidad})`);

        // Intentar meter 12 usuarios a la fuerza (para asegurar que exceda capacidad de 3 u 8)
        let extraBookings = 0;
        for (const u of usuariosBarajados.slice(0, 15)) {
            const { error } = await supabase.from('reservas').insert({
                usuario_id: u.id,
                sesion_id: sesionSaturada.id,
                estado: 'activa',
                es_recuperacion: false
            });
            if (!error) extraBookings++;
        }
        console.log(`   -> Se añadieron ${extraBookings} reservas EXTRA a esta sesión.`);
    }

    console.log('🏁 Proceso finalizado.');
    process.exit(0);
}

main().catch(err => {
    console.error('❌ Error fatal:', err);
    process.exit(1);
});
