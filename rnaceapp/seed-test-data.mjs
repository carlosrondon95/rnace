// seed-test-data.mjs
// Script para poblar la base de datos con datos de prueba realistas
// para probar el flujo de lista de espera

import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

// ============== CONFIGURACIÓN ==============
const supabaseUrl = 'https://bpzdpsmwtsmwrlyxzcsk.supabase.co';
const supabaseKey = '***REMOVED_SUPABASE_KEY***';
const supabase = createClient(supabaseUrl, supabaseKey);

const CAPACIDAD_FOCUS = 3;
const CAPACIDAD_REDUCIDO = 8;
const NUM_CLIENTES_OBJETIVO = 45;
const PASSWORD_PRUEBA = '123456';
const TELEFONO_TESTER = '699999999';

// Nombres españoles realistas
const NOMBRES = [
    'María', 'Carmen', 'Ana', 'Laura', 'Lucía', 'Paula', 'Elena', 'Sara', 'Alba', 'Marta',
    'Carlos', 'Manuel', 'Francisco', 'David', 'Javier', 'Antonio', 'Daniel', 'Pablo', 'Alejandro', 'Miguel',
    'Sofía', 'Isabel', 'Patricia', 'Cristina', 'Andrea', 'Raquel', 'Julia', 'Nuria', 'Sandra', 'Eva',
    'Jorge', 'Fernando', 'Rafael', 'Sergio', 'Luis', 'Alberto', 'José', 'Adrián', 'Diego', 'Álvaro'
];

const APELLIDOS = [
    'García', 'Rodríguez', 'Martínez', 'López', 'González', 'Hernández', 'Pérez', 'Sánchez', 'Ramírez', 'Torres',
    'Flores', 'Rivera', 'Gómez', 'Díaz', 'Reyes', 'Moreno', 'Jiménez', 'Ruiz', 'Álvarez', 'Romero',
    'Navarro', 'Ramos', 'Gil', 'Serrano', 'Blanco', 'Molina', 'Castro', 'Ortiz', 'Rubio', 'Marín'
];

// ============== FUNCIONES AUXILIARES ==============

function randomElement(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generarNombre() {
    return `${randomElement(NOMBRES)} ${randomElement(APELLIDOS)}`;
}

function generarTelefono(index) {
    // Prefijos 61X y 62X para identificar usuarios de prueba
    const prefijo = index < 25 ? '61' : '62';
    const sufijo = String(index).padStart(7, '0');
    return `${prefijo}${sufijo}`;
}

function elegirPlan() {
    const rand = Math.random();
    if (rand < 0.35) return 'focus';
    if (rand < 0.70) return 'reducido';
    if (rand < 0.95) return 'hibrido';
    return 'especial';
}

function elegirClasesPorSemana(tipoPlan) {
    if (tipoPlan === 'especial') return { focus: 0, reducido: 0, porMes: randomInt(4, 8) };

    if (tipoPlan === 'focus') {
        const num = randomInt(2, 4);
        return { focus: num, reducido: 0, porMes: 0 };
    }
    if (tipoPlan === 'reducido') {
        const num = randomInt(2, 4);
        return { focus: 0, reducido: num, porMes: 0 };
    }
    // Híbrido - combinaciones variadas
    const combinaciones = [
        { focus: 1, reducido: 1 },
        { focus: 2, reducido: 1 },
        { focus: 1, reducido: 2 },
        { focus: 2, reducido: 2 },
        { focus: 1, reducido: 3 },
        { focus: 3, reducido: 1 },
    ];
    const combo = randomElement(combinaciones);
    return { ...combo, porMes: 0 };
}

// ============== FUNCIONES PRINCIPALES ==============

async function limpiarDatosPrueba() {
    console.log('🧹 Limpiando datos de prueba anteriores...');

    // Buscar usuarios de prueba (teléfonos que empiezan por 61, 62, o el tester)
    const { data: usuariosPrueba } = await supabase
        .from('usuarios')
        .select('id, telefono')
        .or('telefono.like.61%,telefono.like.62%,telefono.eq.699999999');

    if (!usuariosPrueba || usuariosPrueba.length === 0) {
        console.log('   No hay datos de prueba previos.');
        return;
    }

    const ids = usuariosPrueba.map(u => u.id);
    console.log(`   Encontrados ${ids.length} usuarios de prueba.`);

    // Limpiar en orden correcto (dependencias primero)
    await supabase.from('reservas').delete().in('usuario_id', ids);
    await supabase.from('lista_espera').delete().in('usuario_id', ids);
    await supabase.from('horario_fijo_usuario').delete().in('usuario_id', ids);
    await supabase.from('plan_usuario').delete().in('usuario_id', ids);
    await supabase.from('notificaciones').delete().in('usuario_id', ids);
    await supabase.from('usuarios').delete().in('id', ids);

    console.log('   ✅ Datos de prueba anteriores eliminados.');
}

async function cargarHorariosDisponibles() {
    const { data, error } = await supabase
        .from('horarios_disponibles')
        .select('*')
        .eq('activo', true)
        .order('dia_semana')
        .order('hora');

    if (error) throw error;
    return data || [];
}

async function cargarSesionesFuturas() {
    const hoy = new Date();
    const fechaInicio = hoy.toISOString().split('T')[0];

    // Cargar sesiones de las próximas 5 semanas
    const fechaFin = new Date(hoy);
    fechaFin.setDate(fechaFin.getDate() + 35);

    const { data, error } = await supabase
        .from('sesiones')
        .select('*')
        .gte('fecha', fechaInicio)
        .lte('fecha', fechaFin.toISOString().split('T')[0])
        .eq('cancelada', false)
        .order('fecha')
        .order('hora');

    if (error) throw error;
    return data || [];
}

async function crearClientes(passwordHash, horarios) {
    console.log('\n👥 Creando clientes de prueba...');

    const clientes = [];
    const estadisticas = { focus: 0, reducido: 0, hibrido: 0, especial: 0 };

    for (let i = 0; i < NUM_CLIENTES_OBJETIVO; i++) {
        const nombre = generarNombre();
        const telefono = generarTelefono(i);
        const tipoPlan = elegirPlan();
        const clases = elegirClasesPorSemana(tipoPlan);

        // Crear usuario
        const { data: usuario, error } = await supabase
            .from('usuarios')
            .insert({
                nombre,
                telefono,
                password_hash: passwordHash,
                rol: 'cliente',
                activo: true
            })
            .select()
            .single();

        if (error) {
            console.error(`   ❌ Error creando ${nombre}:`, error.message);
            continue;
        }

        // Crear plan
        await supabase.from('plan_usuario').insert({
            usuario_id: usuario.id,
            tipo_grupo: tipoPlan,
            clases_focus: clases.focus,
            clases_reducido: clases.reducido,
            clases_por_mes: clases.porMes,
            activo: true
        });

        clientes.push({
            ...usuario,
            tipoPlan,
            clases
        });

        estadisticas[tipoPlan]++;
    }

    console.log(`   ✅ Creados ${clientes.length} clientes:`);
    console.log(`      - Focus: ${estadisticas.focus}`);
    console.log(`      - Reducido: ${estadisticas.reducido}`);
    console.log(`      - Híbrido: ${estadisticas.hibrido}`);
    console.log(`      - Especial: ${estadisticas.especial}`);

    return clientes;
}

async function asignarHorariosFijos(clientes, horarios) {
    console.log('\n📅 Asignando horarios fijos...');

    const horariosFocus = horarios.filter(h => h.modalidad === 'focus');
    const horariosReducido = horarios.filter(h => h.modalidad === 'reducido');

    // Contador de asignaciones por horario para distribuir uniformemente
    const contadorHorarios = new Map();
    horarios.forEach(h => contadorHorarios.set(h.id, 0));

    for (const cliente of clientes) {
        if (cliente.tipoPlan === 'especial') continue; // Especiales no tienen horarios fijos

        const horariosAsignar = [];

        // Seleccionar horarios Focus
        if (cliente.clases.focus > 0) {
            const disponibles = [...horariosFocus].sort((a, b) =>
                contadorHorarios.get(a.id) - contadorHorarios.get(b.id)
            );
            for (let i = 0; i < cliente.clases.focus && i < disponibles.length; i++) {
                horariosAsignar.push(disponibles[i]);
                contadorHorarios.set(disponibles[i].id, contadorHorarios.get(disponibles[i].id) + 1);
            }
        }

        // Seleccionar horarios Reducido
        if (cliente.clases.reducido > 0) {
            const disponibles = [...horariosReducido].sort((a, b) =>
                contadorHorarios.get(a.id) - contadorHorarios.get(b.id)
            );
            for (let i = 0; i < cliente.clases.reducido && i < disponibles.length; i++) {
                horariosAsignar.push(disponibles[i]);
                contadorHorarios.set(disponibles[i].id, contadorHorarios.get(disponibles[i].id) + 1);
            }
        }

        // Insertar horarios fijos
        for (const horario of horariosAsignar) {
            await supabase.from('horario_fijo_usuario').insert({
                usuario_id: cliente.id,
                horario_disponible_id: horario.id,
                activo: true
            });
        }

        cliente.horariosAsignados = horariosAsignar;
    }

    console.log('   ✅ Horarios fijos asignados con distribución uniforme.');
}

async function crearReservas(clientes, sesiones, horarios) {
    console.log('\n🎫 Creando reservas basadas en horarios fijos...');

    // Mapa de ocupación por sesión
    const ocupacion = new Map();
    sesiones.forEach(s => ocupacion.set(s.id, 0));

    // Mapa de sesiones por clave (diaSemana-hora-modalidad) para match rápido
    const sesionesMap = new Map();
    sesiones.forEach(s => {
        const fecha = new Date(s.fecha);
        const diaSemana = fecha.getDay() === 0 ? 7 : fecha.getDay(); // 1=Lun, 7=Dom
        const key = `${diaSemana}-${s.hora.slice(0, 5)}-${s.modalidad}`;
        if (!sesionesMap.has(key)) sesionesMap.set(key, []);
        sesionesMap.get(key).push(s);
    });

    let reservasCreadas = 0;
    let reservasSaltadas = 0;

    for (const cliente of clientes) {
        if (!cliente.horariosAsignados) continue;

        for (const horario of cliente.horariosAsignados) {
            const key = `${horario.dia_semana}-${horario.hora.slice(0, 5)}-${horario.modalidad}`;
            const sesionesCoincidentes = sesionesMap.get(key) || [];

            for (const sesion of sesionesCoincidentes) {
                const capacidad = sesion.modalidad === 'focus' ? CAPACIDAD_FOCUS : CAPACIDAD_REDUCIDO;
                const ocupadas = ocupacion.get(sesion.id);

                if (ocupadas < capacidad) {
                    await supabase.from('reservas').insert({
                        usuario_id: cliente.id,
                        sesion_id: sesion.id,
                        estado: 'activa',
                        es_recuperacion: false,
                        es_desde_horario_fijo: true
                    });
                    ocupacion.set(sesion.id, ocupadas + 1);
                    reservasCreadas++;
                } else {
                    reservasSaltadas++;
                }
            }
        }
    }

    console.log(`   ✅ Creadas ${reservasCreadas} reservas`);
    console.log(`   ⚠️  ${reservasSaltadas} reservas saltadas por capacidad llena`);

    return ocupacion;
}

async function saturarSesionesAdicionales(clientes, sesiones, ocupacion) {
    console.log('\n🔥 Saturando sesiones adicionales para pruebas de lista de espera...');

    const sesionesLlenas = { focus: [], reducido: [] };

    // Identificar sesiones que aún no están llenas y saturarlas
    const sesionesFocus = sesiones.filter(s => s.modalidad === 'focus');
    const sesionesReducido = sesiones.filter(s => s.modalidad === 'reducido');

    // Saturar más sesiones Focus (objetivo: 6 sesiones de diferentes días)
    const diasSaturadosFocus = new Set();
    for (const sesion of sesionesFocus) {
        if (diasSaturadosFocus.size >= 6) break;

        const fecha = new Date(sesion.fecha);
        const diaSemana = fecha.getDay();
        const keyDia = `${diaSemana}-${sesion.hora.slice(0, 2)}`; // día + franja horaria

        if (diasSaturadosFocus.has(keyDia)) continue;

        const capacidad = CAPACIDAD_FOCUS;
        let ocupadas = ocupacion.get(sesion.id) || 0;

        // Llenar hasta capacidad
        const clientesDisponibles = clientes.filter(c =>
            c.tipoPlan === 'focus' || c.tipoPlan === 'hibrido'
        );

        for (const cliente of clientesDisponibles) {
            if (ocupadas >= capacidad) break;

            // Verificar que no tenga ya reserva en esta sesión
            const { data: existe } = await supabase
                .from('reservas')
                .select('id')
                .eq('usuario_id', cliente.id)
                .eq('sesion_id', sesion.id)
                .maybeSingle();

            if (!existe) {
                await supabase.from('reservas').insert({
                    usuario_id: cliente.id,
                    sesion_id: sesion.id,
                    estado: 'activa',
                    es_recuperacion: false,
                    es_desde_horario_fijo: false
                });
                ocupadas++;
            }
        }

        if (ocupadas >= capacidad) {
            diasSaturadosFocus.add(keyDia);
            sesionesLlenas.focus.push(sesion);
            ocupacion.set(sesion.id, ocupadas);
        }
    }

    // Saturar más sesiones Reducido (objetivo: 5 sesiones de diferentes días)
    const diasSaturadosReducido = new Set();
    for (const sesion of sesionesReducido) {
        if (diasSaturadosReducido.size >= 5) break;

        const fecha = new Date(sesion.fecha);
        const diaSemana = fecha.getDay();
        const keyDia = `${diaSemana}-${sesion.hora.slice(0, 2)}`;

        if (diasSaturadosReducido.has(keyDia)) continue;

        const capacidad = CAPACIDAD_REDUCIDO;
        let ocupadas = ocupacion.get(sesion.id) || 0;

        const clientesDisponibles = clientes.filter(c =>
            c.tipoPlan === 'reducido' || c.tipoPlan === 'hibrido'
        );

        for (const cliente of clientesDisponibles) {
            if (ocupadas >= capacidad) break;

            const { data: existe } = await supabase
                .from('reservas')
                .select('id')
                .eq('usuario_id', cliente.id)
                .eq('sesion_id', sesion.id)
                .maybeSingle();

            if (!existe) {
                await supabase.from('reservas').insert({
                    usuario_id: cliente.id,
                    sesion_id: sesion.id,
                    estado: 'activa',
                    es_recuperacion: false,
                    es_desde_horario_fijo: false
                });
                ocupadas++;
            }
        }

        if (ocupadas >= capacidad) {
            diasSaturadosReducido.add(keyDia);
            sesionesLlenas.reducido.push(sesion);
            ocupacion.set(sesion.id, ocupadas);
        }
    }

    console.log(`   ✅ Sesiones Focus llenas: ${sesionesLlenas.focus.length}`);
    sesionesLlenas.focus.slice(0, 5).forEach(s => {
        console.log(`      📍 ${s.fecha} ${s.hora.slice(0, 5)} (Focus)`);
    });

    console.log(`   ✅ Sesiones Reducido llenas: ${sesionesLlenas.reducido.length}`);
    sesionesLlenas.reducido.slice(0, 5).forEach(s => {
        console.log(`      📍 ${s.fecha} ${s.hora.slice(0, 5)} (Reducido)`);
    });

    return sesionesLlenas;
}

async function crearClienteTester(passwordHash, horarios) {
    console.log('\n🧪 Creando cliente de prueba especial...');

    // Verificar si ya existe
    const { data: existe } = await supabase
        .from('usuarios')
        .select('id')
        .eq('telefono', TELEFONO_TESTER)
        .maybeSingle();

    if (existe) {
        console.log('   ⚠️  El cliente tester ya existe, actualizando...');
        await supabase.from('reservas').delete().eq('usuario_id', existe.id);
        await supabase.from('lista_espera').delete().eq('usuario_id', existe.id);
        await supabase.from('horario_fijo_usuario').delete().eq('usuario_id', existe.id);
        await supabase.from('plan_usuario').delete().eq('usuario_id', existe.id);
        await supabase.from('usuarios').delete().eq('id', existe.id);
    }

    // Crear usuario tester
    const { data: tester, error } = await supabase
        .from('usuarios')
        .insert({
            nombre: 'Tester Espera',
            telefono: TELEFONO_TESTER,
            password_hash: passwordHash,
            rol: 'cliente',
            activo: true
        })
        .select()
        .single();

    if (error) throw error;

    // Plan híbrido con 4 clases para poder probar todo
    await supabase.from('plan_usuario').insert({
        usuario_id: tester.id,
        tipo_grupo: 'hibrido',
        clases_focus: 2,
        clases_reducido: 2,
        clases_por_mes: 0,
        activo: true
    });

    // Asignar horarios fijos (para que tenga slots en el calendario pero no reservas)
    const horariosFocus = horarios.filter(h => h.modalidad === 'focus').slice(0, 2);
    const horariosReducido = horarios.filter(h => h.modalidad === 'reducido').slice(0, 2);

    for (const h of [...horariosFocus, ...horariosReducido]) {
        await supabase.from('horario_fijo_usuario').insert({
            usuario_id: tester.id,
            horario_disponible_id: h.id,
            activo: true
        });
    }

    // NO crear reservas - el tester empezará limpio para probar el flujo

    console.log('   ✅ Cliente tester creado:');
    console.log(`      📱 Teléfono: ${TELEFONO_TESTER}`);
    console.log(`      🔑 Contraseña: ${PASSWORD_PRUEBA}`);
    console.log('      📋 Plan: Híbrido (2F + 2R)');
    console.log('      ⚡ Sin reservas (listo para probar lista de espera)');

    return tester;
}

// ============== MAIN ==============

async function main() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('   🚀 SEED TEST DATA - Población de BD para pruebas');
    console.log('═══════════════════════════════════════════════════════════\n');

    try {
        // 1. Limpiar datos anteriores
        await limpiarDatosPrueba();

        // 2. Cargar datos base
        console.log('\n📂 Cargando datos base...');
        const horarios = await cargarHorariosDisponibles();
        console.log(`   - ${horarios.length} horarios disponibles`);

        const sesiones = await cargarSesionesFuturas();
        console.log(`   - ${sesiones.length} sesiones futuras`);

        if (sesiones.length === 0) {
            console.error('\n❌ No hay sesiones futuras. Crea sesiones primero en el calendario.');
            process.exit(1);
        }

        // 3. Generar hash de contraseña una sola vez
        const passwordHash = await bcrypt.hash(PASSWORD_PRUEBA, 10);

        // 4. Crear clientes
        const clientes = await crearClientes(passwordHash, horarios);

        // 5. Asignar horarios fijos distribuidos
        await asignarHorariosFijos(clientes, horarios);

        // 6. Crear reservas basadas en horarios fijos
        const ocupacion = await crearReservas(clientes, sesiones, horarios);

        // 7. Saturar sesiones adicionales para pruebas de lista de espera
        const sesionesLlenas = await saturarSesionesAdicionales(clientes, sesiones, ocupacion);

        // 8. Crear cliente tester especial
        await crearClienteTester(passwordHash, horarios);

        // Resumen final
        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('   ✅ PROCESO COMPLETADO');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('\n📊 Resumen:');
        console.log(`   - ${clientes.length} clientes creados`);
        console.log(`   - ${sesionesLlenas.focus.length} sesiones Focus saturadas`);
        console.log(`   - ${sesionesLlenas.reducido.length} sesiones Reducido saturadas`);
        console.log('\n🧪 Para probar lista de espera:');
        console.log(`   1. Inicia sesión con: ${TELEFONO_TESTER} / ${PASSWORD_PRUEBA}`);
        console.log('   2. Ve al Calendario');
        console.log('   3. Busca una sesión LLENA (marcada en rojo)');
        console.log('   4. Prueba el botón "Lista de espera"');
        console.log('');

    } catch (err) {
        console.error('\n❌ Error fatal:', err);
        process.exit(1);
    }
}

main();
