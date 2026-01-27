// Script para investigar la definición de la función 'regenerar_reservas_futuras'
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://bpzdpsmwtsmwrlyxzcsk.supabase.co';
const supabaseKey = '***REMOVED_SUPABASE_KEY***';

const supabase = createClient(supabaseUrl, supabaseKey);

async function investigar() {
    console.log('=== INVESTIGANDO FUNCIÓN SQL regenerar_reservas_futuras ===\n');

    // Supabase no permite ver el código de funciones directamente desde el cliente API público fácilmente
    // pero podemos intentar ejecutarla y ver qué hace, o buscar metadatos si tuviéramos acceso a tablas de sistema
    // Como no podemos ver el código, vamos a usar un enfoque de "caja negra" o buscar en archivos locales.

    // Vamos a intentar ver si existe en information_schema (aunque a veces está restringido)
    const { data, error } = await supabase
        .rpc('get_function_code', { func_name: 'regenerar_reservas_futuras' });
    // Nota: 'get_function_code' no es standard, fallará si no existe.

    if (error) {
        console.log('No se pudo obtener código directamente (esperado).');
        console.log('Error:', error.message);
    }
}

investigar().catch(console.error);
