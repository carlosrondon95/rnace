import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

const supabaseUrl = 'https://bpzdpsmwtsmwrlyxzcsk.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwemRwc213dHNtd3JseXh6Y3NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNTg0MDIsImV4cCI6MjA3NzkzNDQwMn0.ePJ7dYKZz5OllcKxH--1T6N97zKSQS6DZ9ZJ_mljp88';
const supabase = createClient(supabaseUrl, supabaseKey);

const CAPACIDAD_FOCUS = 3;
const CAPACIDAD_REDUCIDO = 8;
const MIN_USUARIOS = 50;

async function main() {
    console.log('🚀 INICIANDO POBLACIÓN SATURADA DE BD');

    // 1. OBTENER CLIENTES EXISTENTES
    const { data: clientesExistentes } = await supabase
        .from('usuarios')
        .select('id, nombre')
        .eq('rol', 'cliente')
        .eq('activo', true);

    console.log(`👥 Clientes actuales: ${clientesExistentes.length}`);

    let clientes = [...clientesExistentes];

    // 2. CREAR USUARIOS SI FALTAN
    if (clientes.length < MIN_USUARIOS) {
        const porCrear = MIN_USUARIOS - clientes.length;
        console.log(`➕ Creando ${porCrear} usuarios nuevos...`);

        const passwordHash = await bcrypt.hash('123456', 10);

        for (let i = 0; i < porCrear; i++) {
            const num = clientes.length + 1;
            const { data: nuevoUser, error } = await supabase
                .from('usuarios')
                .insert({
                    nombre: `Cliente ${num}`,
                    email: `cliente${num}@test.com`,
                    telefono: `600000${num.toString().padStart(3, '0')}`,
                    password: passwordHash,
                    rol: 'cliente',
                    activo: true
                })
                .select()
                .single();

            if (error) console.error('Error creando usuario:', error.message);
            else if (nuevoUser) clientes.push(nuevoUser);
        }
        console.log(`✅ Total clientes ahora: ${clientes.length}`);
    }

    // 3. LIMPIAR DATOS
    const clienteIds = clientes.map(c => c.id);
    console.log('🧹 Limpiando reservas y planes antiguos...');
    await supabase.from('reservas').delete().in('usuario_id', clienteIds);
    await supabase.from('lista_espera').delete().in('usuario_id', clienteIds);
    await supabase.from('plan_usuario').delete().in('usuario_id', clienteIds);
    await supabase.from('horario_fijo_usuario').delete().in('usuario_id', clienteIds);
    console.log('✅ Limpieza completada.');

    // 4. OBTENER SESIONES PRÓXIMA SEMANA
    const hoy = new Date();
    // Añadir 1 día para empezar mañana
    hoy.setDate(hoy.getDate() + 1);
    const mananaStr = hoy.toISOString().split('T')[0];

    // Obtener sesiones desde mañana en adelante
    const { data: sesiones } = await supabase
        .from('sesiones')
        .select('*')
        .gte('fecha', mananaStr)
        .eq('cancelada', false)
        .order('fecha', { ascending: true })
        .limit(50); // Tomar suficientes sesiones

    if (sesiones.length === 0) {
        console.error('❌ No hay sesiones futuras. Crea sesiones en el calendario primero.');
        process.exit(1);
    }

    // 5. SELECCIONAR SESIONES PARA SATURAR
    const sesionesFocus = sesiones.filter(s => s.modalidad === 'focus');
    const sesionesReducido = sesiones.filter(s => s.modalidad === 'reducido');

    if (sesionesFocus.length < 2 || sesionesReducido.length < 2) {
        console.warn('⚠️ Pocas sesiones para saturar. Intentaremos con lo que hay.');
    }

    const aSaturarFocus = sesionesFocus.slice(0, 3); // 3 sesiones Focus para saturar
    const aSaturarReducido = sesionesReducido.slice(0, 2); // 2 sesiones Reducido para saturar

    console.log(`🎯 Objetivo saturación: ${aSaturarFocus.length} Focus, ${aSaturarReducido.length} Reducido`);

    // Control de ocupación
    const ocupacion = new Map();
    sesiones.forEach(s => ocupacion.set(s.id, 0));
    const usuariosAsignados = new Set();

    // 6. SATURAR SESIONES
    console.log('⚡ Saturando sesiones clave...');

    // Función auxiliar para reservar
    async function reservar(usuario, sesion) {
        if (ocupacion.get(sesion.id) >= (sesion.modalidad === 'focus' ? CAPACIDAD_FOCUS : CAPACIDAD_REDUCIDO)) return false;

        await supabase.from('reservas').insert({
            usuario_id: usuario.id,
            sesion_id: sesion.id,
            estado: 'activa',
            es_desde_horario_fijo: true
        });

        ocupacion.set(sesion.id, ocupacion.get(sesion.id) + 1);
        usuariosAsignados.add(usuario.id);

        // Asignar plan compatible si no tiene
        const { data: plan } = await supabase.from('plan_usuario').select('*').eq('usuario_id', usuario.id).maybeSingle();
        if (!plan) {
            await supabase.from('plan_usuario').insert({
                usuario_id: usuario.id,
                tipo_grupo: sesion.modalidad, // 'focus' o 'reducido'
                clases_focus: sesion.modalidad === 'focus' ? 1 : 0,
                clases_reducido: sesion.modalidad === 'reducido' ? 1 : 0,
                activo: true
            });
        }
        return true;
    }

    // Saturar Focus
    for (const sesion of aSaturarFocus) {
        console.log(`   Llenando Focus ${sesion.fecha} ${sesion.hora}...`);
        let count = 0;
        for (const cliente of clientes) {
            if (count >= CAPACIDAD_FOCUS) break;
            // Evitar reservar si ya tiene reserva a esa hora (simple check, no perfecto pero sirve)
            // Aquí simplemente llenamos
            const exito = await reservar(cliente, sesion);
            if (exito) count++;
        }
    }

    // Saturar Reducido
    for (const sesion of aSaturarReducido) {
        console.log(`   Llenando Reducido ${sesion.fecha} ${sesion.hora}...`);
        let count = 0;
        // Usar clientes diferentes si es posible (reverse)
        for (const cliente of [...clientes].reverse()) {
            if (count >= CAPACIDAD_REDUCIDO) break;
            if (ocupacion.get(sesion.id) >= CAPACIDAD_REDUCIDO) break;

            // Verificar si este cliente ya está en esta sesión (por el loop anterior)
            // No verificamos colisiones complejas, solo llenamos
            const exito = await reservar(cliente, sesion);
            if (exito) count++;
        }
    }

    // 7. RELLENAR ALEATORIAMENTE EL RESTO
    console.log('🎲 Rellenando el resto aleatoriamente...');
    const clientesLibres = clientes.filter(c => !usuariosAsignados.has(c.id));

    // Si quedan pocos libres, reutilizar algunos asignados para segunda clase
    const reservaPool = [...clientesLibres, ...clientes.slice(0, 20)];

    for (const cliente of reservaPool) {
        // Elegir sesión aleatoria que no esté llena
        const sesionesDisponibles = sesiones.filter(s => ocupacion.get(s.id) < (s.modalidad === 'focus' ? CAPACIDAD_FOCUS : CAPACIDAD_REDUCIDO));
        if (sesionesDisponibles.length === 0) break;

        const sesion = sesionesDisponibles[Math.floor(Math.random() * sesionesDisponibles.length)];

        // Verificar que no tenga reserva ya en esa sesión
        const { data: existe } = await supabase.from('reservas').select('id').eq('usuario_id', cliente.id).eq('sesion_id', sesion.id).maybeSingle();
        if (!existe) {
            await reservar(cliente, sesion);
        }
    }

    console.log('\n📊 ESTADO FINAL DE SESIONES (Próximas):');
    for (const s of sesiones.slice(0, 10)) { // Mostrar primeras 10
        const oc = ocupacion.get(s.id);
        const cap = s.modalidad === 'focus' ? CAPACIDAD_FOCUS : CAPACIDAD_REDUCIDO;
        const status = oc === cap ? '🔴 LLENA' : (oc === 0 ? '⚪ VACÍA' : '🟢 LIBRE');
        console.log(`   ${s.fecha} ${s.hora} - ${s.modalidad.toUpperCase()}: ${oc}/${cap} ${status}`);
    }

    console.log('\n✅ Proceso finalizado.');
}

main().catch(console.error);
