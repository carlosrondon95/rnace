// Script de diagnóstico COMPLETO del sistema de horarios y reservas
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://bpzdpsmwtsmwrlyxzcsk.supabase.co';
const supabaseKey = '***REMOVED_SUPABASE_KEY***';

const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnosticoCompleto() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║     DIAGNÓSTICO COMPLETO DEL SISTEMA DE RESERVAS          ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    console.log('Fecha actual:', new Date().toISOString(), '\n');

    const diasSemana = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

    // ========== 1. HORARIOS DISPONIBLES ==========
    console.log('═══════════════════════════════════════════════════════════');
    console.log('1. HORARIOS DISPONIBLES (horarios_disponibles)');
    console.log('   Estos son los "turnos" o plantillas de horarios semanales');
    console.log('═══════════════════════════════════════════════════════════\n');

    const { data: horarios } = await supabase
        .from('horarios_disponibles')
        .select('*')
        .order('dia_semana')
        .order('hora');

    console.log(`Total horarios disponibles: ${horarios?.length || 0}`);
    console.log('Horarios activos:');
    horarios?.filter(h => h.activo).forEach(h => {
        console.log(`  ID:${h.id} | ${diasSemana[h.dia_semana]} ${h.hora?.slice(0, 5)} | ${h.modalidad} | cap:${h.capacidad_maxima}`);
    });

    // Buscar específicamente el horario 05:00 viernes
    const horario0500 = horarios?.find(h => h.hora?.includes('05:00') && h.dia_semana === 5);
    if (horario0500) {
        console.log(`\n✓ Horario Viernes 05:00 EXISTE (ID:${horario0500.id}, activo:${horario0500.activo})`);
    } else {
        console.log('\n✗ Horario Viernes 05:00 NO EXISTE');
    }

    // ========== 2. AGENDA_MES ==========
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('2. AGENDA_MES (meses abiertos donde se pueden hacer reservas)');
    console.log('═══════════════════════════════════════════════════════════\n');

    const { data: meses } = await supabase
        .from('agenda_mes')
        .select('*')
        .order('anio')
        .order('mes');

    console.log(`Total meses: ${meses?.length || 0}`);
    meses?.forEach(m => {
        console.log(`  ${m.anio}-${String(m.mes).padStart(2, '0')}: abierto=${m.abierto}`);
    });

    const mesesAbiertos = meses?.filter(m => m.abierto) || [];
    console.log(`\nMeses ABIERTOS: ${mesesAbiertos.length}`);

    // ========== 3. SESIONES ==========
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('3. SESIONES (instancias concretas de clases en fechas específicas)');
    console.log('   Estas se generan a partir de horarios_disponibles');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Buscar sesiones de viernes a las 05:00
    const { data: sesiones0500 } = await supabase
        .from('sesiones')
        .select('*')
        .eq('hora', '05:00:00');

    console.log(`Sesiones a las 05:00 encontradas: ${sesiones0500?.length || 0}`);
    if (sesiones0500?.length) {
        sesiones0500.slice(0, 5).forEach(s => {
            console.log(`  ${s.fecha} ${s.hora.slice(0, 5)} - ${s.modalidad} (cancelada: ${s.cancelada})`);
        });
    } else {
        console.log('  ⚠️ NO HAY SESIONES A LAS 05:00');
    }

    // Buscar sesiones de viernes 04:10 (el horario anterior)
    const { data: sesiones0410 } = await supabase
        .from('sesiones')
        .select('*')
        .eq('hora', '04:10:00');

    console.log(`\nSesiones a las 04:10 encontradas: ${sesiones0410?.length || 0}`);
    if (sesiones0410?.length) {
        sesiones0410.slice(0, 5).forEach(s => {
            console.log(`  ${s.fecha} ${s.hora.slice(0, 5)} - ${s.modalidad}`);
        });
    }

    // Contar total de sesiones por hora (viernes)
    const { data: todasSesiones } = await supabase
        .from('sesiones')
        .select('hora')
        .gte('fecha', '2026-01-01')
        .lte('fecha', '2026-06-30');

    const porHora = {};
    todasSesiones?.forEach(s => {
        const hora = s.hora?.slice(0, 5);
        porHora[hora] = (porHora[hora] || 0) + 1;
    });
    console.log('\nDistribución de sesiones por hora (2026):');
    Object.keys(porHora).sort().forEach(hora => {
        console.log(`  ${hora}: ${porHora[hora]} sesiones`);
    });

    // ========== 4. USUARIOS RECIENTES ==========
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('4. USUARIOS RECIENTES (últimos 5 clientes creados)');
    console.log('═══════════════════════════════════════════════════════════\n');

    const { data: usuarios } = await supabase
        .from('usuarios')
        .select('*')
        .eq('rol', 'cliente')
        .order('creado_en', { ascending: false })
        .limit(5);

    for (const u of (usuarios || [])) {
        console.log(`\n Usuario: ${u.nombre} (ID: ${u.id})`);
        console.log(`   Tel: ${u.telefono}, Activo: ${u.activo}`);
        console.log(`   Creado: ${u.creado_en}`);

        // Plan
        const { data: plan } = await supabase
            .from('plan_usuario')
            .select('*')
            .eq('usuario_id', u.id)
            .single();

        if (plan) {
            console.log(`   Plan: ${plan.tipo_grupo}, activo: ${plan.activo}`);
        } else {
            console.log('   Plan: NINGUNO');
        }

        // Horarios fijos
        const { data: horariosFijos } = await supabase
            .from('horario_fijo_usuario')
            .select(`
                id,
                horario_disponible_id,
                activo,
                horarios_disponibles (id, dia_semana, hora, modalidad)
            `)
            .eq('usuario_id', u.id);

        if (horariosFijos?.length) {
            console.log(`   Horarios fijos (${horariosFijos.length}):`);
            horariosFijos.forEach(hf => {
                const h = hf.horarios_disponibles;
                if (h) {
                    console.log(`     - ${diasSemana[h.dia_semana]} ${h.hora?.slice(0, 5)} ${h.modalidad} (activo: ${hf.activo})`);
                }
            });
        } else {
            console.log('   Horarios fijos: NINGUNO');
        }

        // Reservas
        const { data: reservas } = await supabase
            .from('reservas')
            .select(`
                id,
                estado,
                es_desde_horario_fijo,
                sesiones (fecha, hora, modalidad)
            `)
            .eq('usuario_id', u.id)
            .order('id', { ascending: false })
            .limit(10);

        if (reservas?.length) {
            console.log(`   Reservas (${reservas.length}):`);
            reservas.forEach(r => {
                const s = r.sesiones;
                console.log(`     - ${s?.fecha} ${s?.hora?.slice(0, 5)} ${s?.modalidad} | estado:${r.estado} | auto:${r.es_desde_horario_fijo}`);
            });
        } else {
            console.log('   Reservas: NINGUNA');
        }
    }

    // ========== 5. DIAGNÓSTICO FINAL ==========
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('5. DIAGNÓSTICO Y CONCLUSIONES');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Verificar si hay horarios sin sesiones correspondientes
    const horariosActivos = horarios?.filter(h => h.activo) || [];
    const horasSesiones = new Set(Object.keys(porHora));

    const horariosSinSesiones = horariosActivos.filter(h => {
        const horaSimple = h.hora?.slice(0, 5);
        return !horasSesiones.has(horaSimple);
    });

    if (horariosSinSesiones.length > 0) {
        console.log('⚠️ HORARIOS SIN SESIONES (estos turnos existen pero no tienen sesiones):');
        horariosSinSesiones.forEach(h => {
            console.log(`   - ID:${h.id} ${diasSemana[h.dia_semana]} ${h.hora?.slice(0, 5)} ${h.modalidad}`);
        });
        console.log('\n SOLUCIÓN: Ejecutar migration_sync_sesiones.sql para crear las sesiones faltantes');
    } else {
        console.log('✓ Todos los horarios tienen sesiones correspondientes');
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('FIN DEL DIAGNÓSTICO');
    console.log('═══════════════════════════════════════════════════════════');
}

diagnosticoCompleto().catch(console.error);
