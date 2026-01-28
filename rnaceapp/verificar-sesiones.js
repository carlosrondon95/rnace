// Script para verificar estructura de la tabla sesiones
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://bpzdpsmwtsmwrlyxzcsk.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwemRwc213dHNtd3JseXh6Y3NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNTg0MDIsImV4cCI6MjA3NzkzNDQwMn0.ePJ7dYKZz5OllcKxH--1T6N97zKSQS6DZ9ZJ_mljp88';

const supabase = createClient(supabaseUrl, supabaseKey);

async function verificarEstructura() {
    console.log('=== ESTRUCTURA DE TABLA SESIONES ===\n');

    const { data, error } = await supabase
        .from('sesiones')
        .select('*')
        .limit(1);

    if (error) {
        console.log('Error:', error.message);
    } else if (data && data.length > 0) {
        console.log('Columnas encontradas:');
        Object.keys(data[0]).forEach(key => {
            console.log(`  - ${key}: ${typeof data[0][key]} = ${JSON.stringify(data[0][key])}`);
        });
    } else {
        console.log('No hay datos en sesiones');
    }
}

verificarEstructura().catch(console.error);
