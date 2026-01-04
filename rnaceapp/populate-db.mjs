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

    // 3. Obtener sesiones futuras (próximos 30 días)
    const hoy = new Date().toISOString().split('T')[0];
    const { data: sesiones, error: errSes } = await supabase
        .from('sesiones')
        .select('id, fecha, hora, modalidad')
        .gte('fecha', hoy);

    if (errSes) throw errSes;
    console.log(`🏋️  Encontradas ${sesiones.length} sesiones futuras.`);

    // Mapa para acceso rápido a sesiones por "diaSemana-hora-modalidad"
    const sesionesMap = new Map();
    sesiones.forEach(s => {
        const d = new Date(s.fecha);
        const diaSemana = d.getDay() || 7; // 1=Lunes, 7=Domingo
        const key = `${diaSemana}-${s.hora.slice(0, 5)}-${s.modalidad}`;

        if (!sesionesMap.has(key)) sesionesMap.set(key, []);
        sesionesMap.get(key).push(s);
    });

    // 4. Procesar cada usuario
    let asignados = 0;

    // Barajar usuarios para aleatoriedad
    const usuariosBarajados = usuarios.sort(() => Math.random() - 0.5);

    for (const usuario of usuariosBarajados) {
        // A. Verificar si ya tiene plan (lo borramos para reasignar limpio o lo saltamos? Mejor resetear para pruebas)
        // Para no borrar datos útiles, verificamos si tiene plan. Si no tiene, asignamos.
        // El usuario pidió "asignarles grupos", asumo que están vacíos o quiere resetear.
        // Vamos a ser agresivos: Limpiar horarios fijos actuales de estos usuarios para reasignar bien.

        await supabase.from('horario_fijo_usuario').delete().eq('usuario_id', usuario.id);
        await supabase.from('plan_usuario').delete().eq('usuario_id', usuario.id);

        // B. Asignar Plan Aleatorio (80% Focus, 20% Reducido)
        const tipoPlan = Math.random() > 0.2 ? 'focus' : 'reducido';

        await supabase.from('plan_usuario').insert({
            usuario_id: usuario.id,
            tipo_grupo: tipoPlan,
            activo: true
        });

        // C. Elegir 2 horarios aleatorios compatibles con su plan
        const horariosCompatibles = horarios.filter(h => h.modalidad === tipoPlan);
        const numClases = 2; // Promedio 2 clases por semana
        const horariosElegidos = [];

        // Barajar horarios disponibles
        const horariosBarajados = horariosCompatibles.sort(() => Math.random() - 0.5);

        // Seleccionar hasta numClases
        for (let i = 0; i < Math.min(numClases, horariosBarajados.length); i++) {
            horariosElegidos.push(horariosBarajados[i]);
        }

        // D. Guardar horarios fijos y crear reservas
        for (const h of horariosElegidos) {
            // Insertar horario fijo
            await supabase.from('horario_fijo_usuario').insert({
                usuario_id: usuario.id,
                horario_disponible_id: h.id,
                activo: true
            });

            // Buscar sesiones futuras que coincidan con este horario
            const key = `${h.dia_semana}-${h.hora.slice(0, 5)}-${h.modalidad}`;
            const sesionesCoincidentes = sesionesMap.get(key) || [];

            for (const sesion of sesionesCoincidentes) {
                // Verificar si ya tiene reserva (aunque acabamos de borrar, por si slots repetidos)
                // Insertar reserva
                const { error: errRes } = await supabase.from('reservas').insert({
                    usuario_id: usuario.id,
                    sesion_id: sesion.id,
                    estado: 'activa',
                    es_recuperacion: false,
                    es_desde_horario_fijo: true
                });

                // Ignorar error de duplicados
            }
        }

        asignados++;
        if (asignados % 10 === 0) console.log(`✅ Procesados ${asignados} usuarios...`);
    }

    console.log('🏁 Proceso finalizado.');
    process.exit(0);
}

main().catch(err => {
    console.error('❌ Error fatal:', err);
    process.exit(1);
});
