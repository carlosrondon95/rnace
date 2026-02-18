const BASE = 'https://bpzdpsmwtsmwrlyxzcsk.supabase.co/rest/v1';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwemRwc213dHNtd3JseXh6Y3NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNTg0MDIsImV4cCI6MjA3NzkzNDQwMn0.ePJ7dYKZz5OllcKxH--1T6N97zKSQS6DZ9ZJ_mljp88';
const h = { apikey: KEY, Authorization: `Bearer ${KEY}` };

// 1. Get sessions for Wednesday 25 Feb
const r1 = await fetch(`${BASE}/sesiones?fecha=eq.2026-02-25&cancelada=eq.false&select=id,hora,modalidad,capacidad&order=hora`, { headers: h });
const sesiones = await r1.json();
console.log('=== Sesiones Miércoles 25 Feb ===');
sesiones.forEach(s => console.log(`  ID ${s.id}: ${s.hora.slice(0, 5)} ${s.modalidad} cap=${s.capacidad}`));

// 2. Check the availability view for those sessions
const ids = sesiones.map(s => s.id).join(',');
const r2 = await fetch(`${BASE}/vista_sesiones_disponibilidad?sesion_id=in.(${ids})&select=*`, { headers: h });
const disp = await r2.json();
console.log('\n=== vista_sesiones_disponibilidad ===');
disp.forEach(d => {
    const s = sesiones.find(x => x.id === d.sesion_id);
    console.log(`  ID ${d.sesion_id} (${s?.hora?.slice(0, 5)}): ocupadas=${d.plazas_ocupadas} disponibles=${d.plazas_disponibles}`);
});

// 3. Check actual reservas for those sessions
const r3 = await fetch(`${BASE}/reservas?sesion_id=in.(${ids})&estado=eq.activa&select=id,sesion_id,usuario_id,estado`, { headers: h });
const reservas = await r3.json();
console.log('\n=== Reservas activas por sesión ===');
const porSesion = {};
reservas.forEach(r => {
    if (!porSesion[r.sesion_id]) porSesion[r.sesion_id] = 0;
    porSesion[r.sesion_id]++;
});
sesiones.forEach(s => {
    const count = porSesion[s.id] || 0;
    const disp2 = disp.find(d => d.sesion_id === s.id);
    const flag = count !== (disp2?.plazas_ocupadas || 0) ? ' ⚠️ DISCREPANCIA' : '';
    console.log(`  ID ${s.id} (${s.hora.slice(0, 5)}): reservas_reales=${count} | vista_ocupadas=${disp2?.plazas_ocupadas ?? 'N/A'} | vista_disponibles=${disp2?.plazas_disponibles ?? 'N/A'}${flag}`);
});

// 4. Check if there are reservas with other states (cancelled but still counted?)
const r4 = await fetch(`${BASE}/reservas?sesion_id=in.(${ids})&select=id,sesion_id,estado`, { headers: h });
const todasReservas = await r4.json();
console.log('\n=== Todas las reservas (todos los estados) ===');
const porSesionEstado = {};
todasReservas.forEach(r => {
    const key = `${r.sesion_id}_${r.estado}`;
    porSesionEstado[key] = (porSesionEstado[key] || 0) + 1;
});
Object.entries(porSesionEstado).forEach(([k, v]) => console.log(`  sesion_${k}: ${v}`));
