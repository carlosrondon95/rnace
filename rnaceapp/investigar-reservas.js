// Script para investigar por qué no se generan reservas para usuarios nuevos
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://bpzdpsmwtsmwrlyxzcsk.supabase.co';
const supabaseKey = '***REMOVED_SUPABASE_KEY***';

const supabase = createClient(supabaseUrl, supabaseKey);

async function investigar() {
    console.log('=== INVESTIGACIÓN DE RESERVAS FALTANTES ===\n');
    console.log('Fecha actual:', new Date().toISOString(), '\n');

    // 1. Buscar los usuarios mencionados
    console.log('=== 1. BUSCANDO USUARIOS MENCIONADOS ===');
    const telefonos = ['987654321', '321654987'];

    for (const tel of telefonos) {
        const { data: usuario, error } = await supabase
            .from('usuarios')
            .select('*')
            .eq('telefono', tel)
            .single();

        if (error) {
            console.log(`Teléfono ${tel}: NO ENCONTRADO (${error.message})`);
        } else {
            console.log(`\nTeléfono ${tel}:`);
            console.log(`  ID: ${usuario.id}`);
            console.log(`  Nombre: ${usuario.nombre}`);
            console.log(`  Rol: ${usuario.rol}`);
            console.log(`  Activo: ${usuario.activo}`);
            console.log(`  Creado: ${usuario.creado_en}`);

            // Buscar plan de usuario
            const { data: plan } = await supabase
                .from('plan_usuario')
                .select('*')
                .eq('usuario_id', usuario.id)
                .single();

            if (plan) {
                console.log(`  Plan: tipo_grupo=${plan.tipo_grupo}, activo=${plan.activo}`);
            } else {
                console.log(`  Plan: NO TIENE PLAN`);
            }

            // Buscar horarios fijos
            const { data: horarios } = await supabase
                .from('horario_fijo_usuario')
                .select(`
                    id,
                    horario_disponible_id,
                    activo,
                    horarios_disponibles (
                        id, modalidad, dia_semana, hora
                    )
                `)
                .eq('usuario_id', usuario.id);

            if (horarios && horarios.length > 0) {
                console.log(`  Horarios fijos (${horarios.length}):`);
                const diasSemana = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
                horarios.forEach(hf => {
                    const h = hf.horarios_disponibles;
                    if (h) {
                        console.log(`    - ${diasSemana[h.dia_semana]} ${h.hora?.slice(0, 5)} ${h.modalidad} (activo: ${hf.activo})`);
                    }
                });
            } else {
                console.log(`  Horarios fijos: NINGUNO`);
            }

            // Buscar reservas
            const { data: reservas } = await supabase
                .from('reservas')
                .select(`
                    id,
                    estado,
                    es_desde_horario_fijo,
                    sesiones (id, fecha, hora, modalidad)
                `)
                .eq('usuario_id', usuario.id);

            if (reservas && reservas.length > 0) {
                console.log(`  Reservas (${reservas.length}):`);
                reservas.slice(0, 10).forEach(r => {
                    const s = r.sesiones;
                    console.log(`    - ${s?.fecha} ${s?.hora?.slice(0, 5)} ${s?.modalidad} (estado: ${r.estado}, auto: ${r.es_desde_horario_fijo})`);
                });
                if (reservas.length > 10) {
                    console.log(`    ... y ${reservas.length - 10} más`);
                }
            } else {
                console.log(`  Reservas: NINGUNA`);
            }
        }
    }

    // 2. Verificar tabla agenda_mes
    console.log('\n\n=== 2. ESTADO DE AGENDA_MES ===');
    const { data: agendaMes } = await supabase
        .from('agenda_mes')
        .select('*')
        .order('anio')
        .order('mes');

    if (agendaMes && agendaMes.length > 0) {
        console.log(`Total meses en agenda_mes: ${agendaMes.length}`);
        agendaMes.forEach(am => {
            console.log(`  ${am.anio}-${String(am.mes).padStart(2, '0')}: abierto=${am.abierto}`);
        });
    } else {
        console.log('⚠️  TABLA agenda_mes ESTÁ VACÍA - ESTO ES EL PROBLEMA');
        console.log('   La función regenerar_reservas_futuras necesita meses con abierto=true');
    }

    // 3. Verificar sesiones disponibles para el mes actual y próximo
    console.log('\n\n=== 3. SESIONES DISPONIBLES ===');
    const hoy = new Date();
    const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
    const ultimoDiaProxMes = new Date(hoy.getFullYear(), hoy.getMonth() + 2, 0).toISOString().split('T')[0];

    const { data: sesiones, error: sesionesError } = await supabase
        .from('sesiones')
        .select('id, fecha, hora, modalidad')
        .gte('fecha', primerDiaMes)
        .lte('fecha', ultimoDiaProxMes)
        .eq('cancelada', false)
        .order('fecha')
        .limit(20);

    if (sesionesError) {
        console.log(`Error al consultar sesiones: ${sesionesError.message}`);
    } else if (sesiones && sesiones.length > 0) {
        console.log(`Sesiones desde ${primerDiaMes} hasta ${ultimoDiaProxMes}: ${sesiones.length} (mostrando primeras 20)`);
        sesiones.forEach(s => {
            console.log(`  ${s.fecha} ${s.hora?.slice(0, 5)} - ${s.modalidad}`);
        });
    } else {
        console.log('⚠️  NO HAY SESIONES para el período consultado');
    }

    // 4. Intentar ejecutar la función regenerar_reservas_futuras para un usuario
    console.log('\n\n=== 4. PRUEBA DE FUNCIÓN regenerar_reservas_futuras ===');

    // Buscar uno de los usuarios para test
    const { data: testUser } = await supabase
        .from('usuarios')
        .select('id, nombre')
        .eq('telefono', '987654321')
        .single();

    if (testUser) {
        console.log(`Ejecutando regenerar_reservas_futuras para ${testUser.nombre} (${testUser.id})...`);

        const { data: resultado, error: rpcError } = await supabase
            .rpc('regenerar_reservas_futuras', { p_usuario_id: testUser.id });

        if (rpcError) {
            console.log(`Error: ${rpcError.message}`);
        } else {
            console.log('Resultado:', JSON.stringify(resultado, null, 2));
        }
    } else {
        console.log('Usuario de test no encontrado');
    }

    console.log('\n\n=== FIN DE LA INVESTIGACIÓN ===');
}

investigar().catch(console.error);
