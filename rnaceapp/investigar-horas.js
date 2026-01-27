// Script para verificar los horarios_disponibles_id asignados al cliente
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://bpzdpsmwtsmwrlyxzcsk.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwemRwc213dHNtd3JseXh6Y3NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNTg0MDIsImV4cCI6MjA3NzkzNDQwMn0.ePJ7dYKZz5OllcKxH--1T6N97zKSQS6DZ9ZJ_mljp88';

const supabase = createClient(supabaseUrl, supabaseKey);

const userId = 'b3f22f81-bb5b-4717-9344-db41078ace95';

async function investigar() {
    console.log('=== VERIFICANDO HORARIOS_FIJO_USUARIO ===\n');

    // 1. Obtener todos los horarios_fijo_usuario del cliente
    const { data: horariosFijos } = await supabase
        .from('horario_fijo_usuario')
        .select(`
      id,
      horario_disponible_id,
      activo,
      creado_en,
      horarios_disponibles (
        id, modalidad, dia_semana, hora
      )
    `)
        .eq('usuario_id', userId);

    console.log('Horarios fijos del usuario:');
    const diasSemana = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

    if (horariosFijos && horariosFijos.length > 0) {
        horariosFijos.forEach((hf, i) => {
            const h = hf.horarios_disponibles;
            if (h) {
                console.log(`  ${i + 1}. ID:${hf.id} -> horario_disponible_id:${hf.horario_disponible_id}`);
                console.log(`       ${diasSemana[h.dia_semana]} ${h.hora} - ${h.modalidad} (activo: ${hf.activo})`);
                console.log(`       Creado: ${hf.creado_en}`);
            }
        });
    }

    // 2. Obtener TODOS los horarios_disponibles para ver la tabla completa
    const { data: horariosDisponibles } = await supabase
        .from('horarios_disponibles')
        .select('*')
        .eq('activo', true)
        .order('dia_semana')
        .order('hora');

    console.log('\n\n=== TODOS LOS HORARIOS DISPONIBLES ===');
    console.log(`Total: ${horariosDisponibles?.length || 0}\n`);

    if (horariosDisponibles) {
        // Agrupar por día
        const porDia = {};
        horariosDisponibles.forEach(h => {
            const dia = diasSemana[h.dia_semana];
            if (!porDia[dia]) porDia[dia] = [];
            porDia[dia].push(h);
        });

        for (const [dia, horarios] of Object.entries(porDia)) {
            console.log(`${dia}:`);
            horarios.forEach(h => {
                console.log(`  ID:${h.id} ${h.hora} - ${h.modalidad} (capacidad: ${h.capacidad_maxima})`);
            });
        }
    }

    // 3. Verificar si hay sesiones que coincidan con horarios de Martes/Jueves
    console.log('\n\n=== VERIFICANDO SESIONES DE MARTES Y JUEVES ===');

    const { data: sesionesMarJue } = await supabase
        .from('sesiones')
        .select('id, fecha, hora, modalidad')
        .or('hora.eq.16:00:00,hora.eq.08:00:00')
        .gte('fecha', '2026-01-01')
        .lte('fecha', '2026-03-31')
        .eq('cancelada', false)
        .order('fecha');

    if (sesionesMarJue) {
        const martesJueves = sesionesMarJue.filter(s => {
            const d = new Date(s.fecha);
            return d.getDay() === 2 || d.getDay() === 4; // Martes o Jueves
        });

        console.log(`Sesiones de Martes/Jueves con hora 08:00 o 16:00: ${martesJueves.length}`);
        martesJueves.slice(0, 10).forEach(s => {
            const d = new Date(s.fecha);
            const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
            console.log(`  ${s.fecha} (${dias[d.getDay()]}) ${s.hora?.substring(0, 5)} - ${s.modalidad}`);
        });
    }

    // 4. Verificar la modalidad del matching en sincronizarReservasUsuario
    console.log('\n\n=== SIMULANDO SINCRONIZACIÓN ===');
    console.log('Horarios del usuario mapeados (formato dia_semana-hora):');

    const horariosMap = new Set();
    horariosFijos?.forEach((hf) => {
        const hd = hf.horarios_disponibles;
        if (hd) {
            const horaSimple = hd.hora.slice(0, 5);
            const key = `${hd.dia_semana}-${horaSimple}`;
            console.log(`  Key: "${key}" -> ${diasSemana[hd.dia_semana]} ${horaSimple} (${hd.modalidad})`);
            horariosMap.add(key);
        }
    });

    // 5. ¿Qué sesiones matchearían?
    const { data: todasSesiones } = await supabase
        .from('sesiones')
        .select('id, fecha, hora, modalidad')
        .gte('fecha', '2026-01-01')
        .lte('fecha', '2026-01-31')
        .eq('cancelada', false);

    console.log('\n\nSesiones de enero que matchearían con las keys del usuario:');

    todasSesiones?.forEach(s => {
        const d = new Date(s.fecha);
        const jsDay = d.getDay();
        const sistemaDia = jsDay === 0 ? 7 : jsDay;
        const horaSimple = s.hora.slice(0, 5);
        const key = `${sistemaDia}-${horaSimple}`;

        if (horariosMap.has(key)) {
            const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
            console.log(`  MATCH: ${s.fecha} (${dias[d.getDay()]}) ${horaSimple} - ${s.modalidad} (key: ${key})`);
        }
    });
}

investigar().catch(console.error);
