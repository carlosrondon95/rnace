// Script para investigar por qué el horario 04:10 no genera reservas
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://bpzdpsmwtsmwrlyxzcsk.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwemRwc213dHNtd3JseXh6Y3NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNTg0MDIsImV4cCI6MjA3NzkzNDQwMn0.ePJ7dYKZz5OllcKxH--1T6N97zKSQS6DZ9ZJ_mljp88';

const supabase = createClient(supabaseUrl, supabaseKey);

async function investigar() {
    console.log('=== INVESTIGANDO HORARIO 04:10 ===\n');

    // 1. Ver todos los horarios_disponibles
    console.log('=== 1. HORARIOS DISPONIBLES (horarios_disponibles) ===');
    const { data: horarios } = await supabase
        .from('horarios_disponibles')
        .select('*')
        .eq('activo', true)
        .order('dia_semana')
        .order('hora');

    const diasSemana = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

    if (horarios) {
        console.log(`Total horarios disponibles: ${horarios.length}`);
        horarios.forEach(h => {
            console.log(`  ID:${h.id} ${diasSemana[h.dia_semana]} ${h.hora?.slice(0, 5)} - ${h.modalidad} (cap: ${h.capacidad_maxima})`);
        });
    }

    // 2. Ver sesiones del viernes (dia_semana 5)
    console.log('\n\n=== 2. SESIONES DE VIERNES EN ENERO/FEBRERO 2026 ===');
    const { data: sesionesViernes } = await supabase
        .from('sesiones')
        .select('id, fecha, hora, modalidad')
        .gte('fecha', '2026-01-01')
        .lte('fecha', '2026-02-28')
        .eq('cancelada', false)
        .order('fecha')
        .order('hora');

    if (sesionesViernes) {
        // Filtrar solo viernes
        const viernes = sesionesViernes.filter(s => {
            const d = new Date(s.fecha);
            return d.getDay() === 5; // Viernes
        });

        console.log(`Sesiones de viernes encontradas: ${viernes.length}`);

        // Agrupar por hora
        const porHora = {};
        viernes.forEach(s => {
            const hora = s.hora?.slice(0, 5);
            if (!porHora[hora]) porHora[hora] = 0;
            porHora[hora]++;
        });

        console.log('\nSesiones por hora:');
        Object.keys(porHora).sort().forEach(hora => {
            console.log(`  ${hora}: ${porHora[hora]} sesiones`);
        });

        // ¿Hay sesiones a las 04:10?
        const sesiones0410 = viernes.filter(s => s.hora?.slice(0, 5) === '04:10');
        console.log(`\nSesiones de viernes a las 04:10: ${sesiones0410.length}`);
        if (sesiones0410.length === 0) {
            console.log('⚠️  NO HAY SESIONES PARA VIERNES 04:10');
            console.log('   Las sesiones se crean basándose en horarios_disponibles');
            console.log('   Pero parece que no se han generado sesiones para este nuevo horario');
        }
    }

    // 3. Verificar si el horario 04:10 existe en horarios_disponibles
    console.log('\n\n=== 3. HORARIOS DISPONIBLES A LAS 04:10 ===');
    const { data: horarios0410 } = await supabase
        .from('horarios_disponibles')
        .select('*')
        .eq('hora', '04:10:00');

    if (horarios0410 && horarios0410.length > 0) {
        console.log('Sí existe el horario 04:10:');
        horarios0410.forEach(h => {
            console.log(`  ID:${h.id} ${diasSemana[h.dia_semana]} ${h.hora} - ${h.modalidad}`);
        });
    } else {
        // Buscar con like
        const { data: horariosLike } = await supabase
            .from('horarios_disponibles')
            .select('*')
            .like('hora', '04:10%');

        if (horariosLike && horariosLike.length > 0) {
            console.log('Encontrado con LIKE:');
            horariosLike.forEach(h => {
                console.log(`  ID:${h.id} ${diasSemana[h.dia_semana]} ${h.hora} - ${h.modalidad}`);
            });
        } else {
            console.log('No existe horario disponible a las 04:10');
        }
    }

    // 4. ¿Cómo se crean las sesiones? Buscar la lógica
    console.log('\n\n=== 4. DIAGNÓSTICO ===');
    console.log('El problema es que:');
    console.log('1. Se crea un horario_disponible nuevo (ej: Viernes 04:10)');
    console.log('2. Se puede asignar a un cliente (horario_fijo_usuario)');
    console.log('3. PERO no existen sesiones en la tabla "sesiones" para ese día/hora');
    console.log('4. La función regenerar_reservas_futuras busca sesiones que coincidan');
    console.log('5. Como no hay sesiones a las 04:10, no se crean reservas');
    console.log('\nSOLUCIÓN: Hay que generar sesiones para los nuevos horarios_disponibles');
}

investigar().catch(console.error);
