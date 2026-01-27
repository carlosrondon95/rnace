// Script para VERIFICACIÓN FINAL de reservas de Carlos Rondón Pérez
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://bpzdpsmwtsmwrlyxzcsk.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwemRwc213dHNtd3JseXh6Y3NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNTg0MDIsImV4cCI6MjA3NzkzNDQwMn0.ePJ7dYKZz5OllcKxH--1T6N97zKSQS6DZ9ZJ_mljp88';

const supabase = createClient(supabaseUrl, supabaseKey);

const userId = 'b3f22f81-bb5b-4717-9344-db41078ace95';

async function verificar() {
    console.log('=== VERIFICACIÓN FINAL: RESERVAS DE CARLOS RONDÓN PÉREZ ===\n');

    // 1. Obtener TODAS las reservas activas
    const { data: reservas } = await supabase
        .from('reservas')
        .select(`
      id,
      estado,
      sesion_id,
      sesiones (
        id, fecha, hora, modalidad
      )
    `)
        .eq('usuario_id', userId)
        .eq('estado', 'activa');

    console.log('Total reservas activas:', reservas?.length || 0);

    if (reservas && reservas.length > 0) {
        const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

        // Contar por día de la semana
        const porDia = {};
        const porModalidad = {};

        let hayErrores = false;

        reservas.forEach(r => {
            const s = Array.isArray(r.sesiones) ? r.sesiones[0] : r.sesiones;
            if (!s) return;

            const fecha = new Date(s.fecha);
            const diaNombre = diasSemana[fecha.getDay()];

            // Por día
            if (!porDia[diaNombre]) porDia[diaNombre] = 0;
            porDia[diaNombre]++;

            // Por modalidad
            if (!porModalidad[s.modalidad]) porModalidad[s.modalidad] = 0;
            porModalidad[s.modalidad]++;

            // Validar
            const esDiaIncorrecto = diaNombre === 'Martes' || diaNombre === 'Jueves';
            const esModalidadIncorrecta = s.modalidad === 'reducido';

            if (esDiaIncorrecto || esModalidadIncorrecta) {
                console.error(`❌ ERROR: Reserva incorrecta encontrada: ${s.fecha} ${diaNombre} ${s.modalidad}`);
                hayErrores = true;
            }
        });

        console.log('\n=== DISTRIBUCIÓN POR DÍA ===');
        console.log(porDia);

        console.log('\n=== DISTRIBUCIÓN POR MODALIDAD ===');
        console.log(porModalidad);

        if (!hayErrores) {
            console.log('\n✅ VERIFICACIÓN EXITOSA: Solo hay reservas de Lunes, Miércoles y Viernes (Focus).');
        } else {
            console.error('\n❌ VERIFICACIÓN FALLIDA: Aún quedan reservas incorrectas.');
        }
    } else {
        console.log('⚠️ El usuario no tiene reservas (posiblemente necesita resincronizar desde la web).');
    }
}

verificar().catch(console.error);
