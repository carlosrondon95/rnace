import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://bpzdpsmwtsmwrlyxzcsk.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwemRwc213dHNtd3JseXh6Y3NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNTg0MDIsImV4cCI6MjA3NzkzNDQwMn0.ePJ7dYKZz5OllcKxH--1T6N97zKSQS6DZ9ZJ_mljp88';
const supabase = createClient(supabaseUrl, supabaseKey);

async function buscarTriggersFestivo() {
    console.log('🔍 Buscando triggers y funciones relacionados con festivos/cancelaciones...\n');

    // Buscar notificaciones recientes de tipo cancelacion
    const { data: notifs, error } = await supabase
        .from('notificaciones')
        .select('*')
        .eq('tipo', 'cancelacion')
        .order('creado_en', { ascending: false })
        .limit(5);

    if (error) {
        console.log('Error:', error.message);
    } else {
        console.log('📬 Últimas notificaciones de cancelación:');
        notifs?.forEach(n => {
            console.log(`  - Título: ${n.titulo}`);
            console.log(`    Mensaje: ${n.mensaje}`);
            console.log(`    Creada: ${n.creado_en}`);
            console.log('');
        });
    }

    // Buscar notificaciones con "festivo" en el mensaje
    const { data: notifsFestivo } = await supabase
        .from('notificaciones')
        .select('*')
        .ilike('mensaje', '%festivo%')
        .order('creado_en', { ascending: false })
        .limit(5);

    console.log('\n📬 Notificaciones que mencionan "festivo":');
    notifsFestivo?.forEach(n => {
        console.log(`  - Tipo: ${n.tipo}`);
        console.log(`    Título: ${n.titulo}`);
        console.log(`    Mensaje: ${n.mensaje}`);
        console.log('');
    });
}

buscarTriggersFestivo().then(() => process.exit(0)).catch(console.error);
