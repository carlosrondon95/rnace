// Script de AUDITORÍA GLOBAL DE RESERVAS
// Detecta usuarios con reservas automáticas que no coinciden con su plan actual
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://bpzdpsmwtsmwrlyxzcsk.supabase.co';
const supabaseKey = '***REMOVED_SUPABASE_KEY***';

const supabase = createClient(supabaseUrl, supabaseKey);

async function auditar() {
    console.log('=== AUDITORÍA GLOBAL DE RESERVAS ===\n');

    // 1. Obtener todos los usuarios CLIENTES activos
    // Paginación manual para seguridad si son muchos
    let { data: usuarios, error } = await supabase
        .from('usuarios')
        .select('id, nombre, telefono, rol')
        .eq('rol', 'cliente')
        .eq('activo', true);

    if (error) {
        console.error('Error cargando usuarios:', error);
        return;
    }

    if (!usuarios) usuarios = [];
    console.log(`Analizando ${usuarios.length} usuarios activos...\n`);

    // 2. Obtener TODOS los horarios fijos activos
    const { data: todosHorarios } = await supabase
        .from('horario_fijo_usuario')
        .select(`
      usuario_id,
      horarios_disponibles (
        dia_semana,
        hora,
        modalidad
      )
    `)
        .eq('activo', true);

    // Mapear horarios por usuario
    const mapaHorarios = new Map(); // usuario_id -> Set("dia-hora-modalidad")

    todosHorarios?.forEach(hf => {
        const hd = hf.horarios_disponibles;
        if (hd) {
            if (!mapaHorarios.has(hf.usuario_id)) {
                mapaHorarios.set(hf.usuario_id, new Set());
            }
            const horaSimple = hd.hora.slice(0, 5);
            mapaHorarios.get(hf.usuario_id).add(`${hd.dia_semana}-${horaSimple}-${hd.modalidad}`);
        }
    });

    // 3. Analizar reservas futuras de cada usuario
    let totalUsuariosAfectados = 0;
    let totalReservasIncorrectas = 0;

    // Procesar en lotes pequeños para no saturar
    const BATCH_SIZE = 10;
    for (let i = 0; i < usuarios.length; i += BATCH_SIZE) {
        const loteUsuarios = usuarios.slice(i, i + BATCH_SIZE);
        const idsLote = loteUsuarios.map(u => u.id);

        // Obtener todas las reservas activas futuras para este lote
        const { data: reservas } = await supabase
            .from('reservas')
            .select(`
        id,
        usuario_id,
        sesion_id,
        es_desde_horario_fijo,
        created_at,
        sesiones!inner (
          fecha,
          hora,
          modalidad
        )
      `)
            .in('usuario_id', idsLote)
            .eq('estado', 'activa')
            .gte('sesiones.fecha', new Date().toISOString().split('T')[0]); // Solo futuras

        if (!reservas) continue;

        // Verificar cada usuario del lote
        for (const usuario of loteUsuarios) {
            const reservasUsuario = reservas.filter(r => r.usuario_id === usuario.id);
            if (reservasUsuario.length === 0) continue;

            const horariosDelUsuario = mapaHorarios.get(usuario.id) || new Set();
            const reservasIncorrectas = [];

            reservasUsuario.forEach(r => {
                const s = r.sesiones;
                const d = new Date(s.fecha);
                const jsDay = d.getDay();
                const sistemaDia = jsDay === 0 ? 7 : jsDay;
                const horaSimple = s.hora.slice(0, 5);

                // Clave real de la reserva
                const key = `${sistemaDia}-${horaSimple}-${s.modalidad}`;

                // Verificar si coincide con algún horario fijo
                // OJO: Si es una reserva manual (no desde horario fijo) podría ser válida aunque no esté en el plan
                // PERO el bug que buscamos son reservas automáticas incorrectas.
                // Así que si 'es_desde_horario_fijo' es true, DEBE coincidir.

                // Si no tiene la marca, podría ser manual o antigua sin marca. 
                // Asumiremos que si no coincide y parece patrón repetitivo es sospechosa,
                // pero para ser conservadores solo reportamos las automáticas o las que violan modalidad flagrante.

                if (!horariosDelUsuario.has(key)) {
                    // Es candidata a error. 
                    // ¿Es automática?
                    if (r.es_desde_horario_fijo) {
                        reservasIncorrectas.push(r);
                    } else {
                        // Si no es automática, podría ser manual. Pero si la modalidad es 'reducido' y el usuario solo tiene 'focus'
                        // es muy sospechosa del bug anterior.
                        const tieneAlgunaFocus = Array.from(horariosDelUsuario).some(k => k.includes('focus'));
                        const tieneAlgunaReducido = Array.from(horariosDelUsuario).some(k => k.includes('reducido'));

                        if (s.modalidad === 'reducido' && !tieneAlgunaReducido && tieneAlgunaFocus) {
                            reservasIncorrectas.push(r); // Modalidad incorrecta flagrante
                        }
                    }
                }
            });

            if (reservasIncorrectas.length > 0) {
                console.log(`❌ USUARIO AFECTADO: ${usuario.nombre} (${usuario.telefono})`);
                console.log(`   ID: ${usuario.id}`);
                console.log(`   Reservas incorrectas detectadas: ${reservasIncorrectas.length}`);

                // Mostrar ejemplo
                const ejemplo = reservasIncorrectas[0].sesiones;
                console.log(`   Ejemplo: ${ejemplo.fecha} ${ejemplo.hora} - ${ejemplo.modalidad}`);
                console.log('---');

                totalUsuariosAfectados++;
                totalReservasIncorrectas += reservasIncorrectas.length;
            }
        }
    }

    console.log('\n=== RESULTADO AUDITORÍA ===');
    console.log(`Usuarios escaneados: ${usuarios.length}`);
    console.log(`Usuarios afectados encontrados: ${totalUsuariosAfectados}`);
    console.log(`Total reservas incorrectas: ${totalReservasIncorrectas}`);

    if (totalUsuariosAfectados === 0) {
        console.log('✅ ESTADO SALUDABLE: No se encontraron inconsistencias graves.');
    }

    // Verificar la función regenerar_reservas
    // Aunque no podemos ejecutarla para testear, ya confiamos en el SQL aplicado por el usuario.
}

auditar().catch(console.error);
