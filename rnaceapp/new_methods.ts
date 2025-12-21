// Variable para almacenar las reservas del usuario en el día actual
misReservasDelDia = signal<{ id: number; sesion_id: number; hora: string }[]>([]);

  async onClickDia(dia: DiaCalendario) {
    if (this.modoEdicion()) {
        this.toggleFestivo(dia);
        return;
    }
    if (this.esAdmin()) {
        if (dia.reservas.length > 0) this.diaSeleccionado.set(dia);
        return;
    }
    if (dia.esDelMes && dia.esLaborable && !dia.esFestivo) {
        this.diaSeleccionado.set(dia);
        await this.cargarSesionesDia(dia.fecha);
    }
}

  async cargarSesionesDia(fecha: string) {
    const uid = this.userId();
    if (!uid) return;
    this.cargando.set(true);
    try {
        const { data: sesiones, error } = await supabase()
            .from('sesiones').select('*').eq('fecha', fecha).eq('cancelada', false).order('hora');
        if (error) throw error;
        if (!sesiones || sesiones.length === 0) {
            this.sesionesDiaSeleccionado.set([]);
            this.misReservasDelDia.set([]);
            return;
        }
        const { data: espera } = await supabase().from('lista_espera').select('sesion_id').eq('usuario_id', uid).in('sesion_id', sesiones.map(s => s.id));
        const esperaSet = new Set(espera?.map(e => e.sesion_id) || []);
        const { data: reservas } = await supabase().from('reservas').select('id, sesion_id, estado').eq('usuario_id', uid).eq('estado', 'activa').in('sesion_id', sesiones.map(s => s.id));

        const reservasMap = new Map();
        const misReservas = [];
        if (reservas) {
            reservas.forEach(r => {
                reservasMap.set(r.sesion_id, r.id);
                const s = sesiones.find(ses => ses.id === r.sesion_id);
                if (s) misReservas.push({ id: r.id, sesion_id: r.sesion_id, hora: s.hora.slice(0, 5) });
            });
        }
        this.misReservasDelDia.set(misReservas);

        const sesionesDia = sesiones.map(s => ({
            id: s.id, hora: s.hora.slice(0, 5), modalidad: s.modalidad, capacidad: s.capacidad,
            plazas_ocupadas: 0, plazas_disponibles: 0,
            tiene_reserva: reservasMap.has(s.id), mi_reserva_id: reservasMap.get(s.id), en_lista_espera: esperaSet.has(s.id)
        }));

        const { data: disponibilidad } = await supabase().from('vista_sesiones_disponibilidad').select('sesion_id, plazas_ocupadas, plazas_disponibles').in('sesion_id', sesiones.map(s => s.id));
        if (disponibilidad) {
            const dispMap = new Map(disponibilidad.map(d => [d.sesion_id, d]));
            sesionesDia.forEach(s => {
                const d = dispMap.get(s.id);
                if (d) { s.plazas_ocupadas = d.plazas_ocupadas; s.plazas_disponibles = d.plazas_disponibles; }
            });
        }
        this.sesionesDiaSeleccionado.set(sesionesDia);
    } catch (err) { console.error(err); } finally { this.cargando.set(false); }
}

  async cambiarTurno(reservaId: number, nuevaSesionId: number) {
    const uid = this.userId();
    if (!uid) return;
    if (!confirm('¿Seguro que quieres cambiar tu clase a este nuevo horario?')) return;
    this.guardando.set(true);
    try {
        const { data, error } = await supabase().rpc('cambiar_turno', { p_usuario_id: uid, p_reserva_id: reservaId, p_nueva_sesion_id: nuevaSesionId });
        if (error) throw error;
        if (data && data[0]?.ok) {
            this.mensajeExito.set(data[0].mensaje);
            const dia = this.diaSeleccionado();
            if (dia) { await this.cargarSesionesDia(dia.fecha); this.cargarCalendario(); }
        } else { this.error.set(data?.[0]?.mensaje || 'No se pudo cambiar.'); }
    } catch (err: any) { this.error.set(err.message || 'Error.'); } finally { this.guardando.set(false); }
}

  async apuntarseListaEspera(sesionId: number) {
    const uid = this.userId();
    if (!uid) return;
    this.guardando.set(true);
    try {
        const { data, error } = await supabase().rpc('apuntarse_lista_espera', { p_usuario_id: uid, p_sesion_id: sesionId });
        if (error) throw error;
        if (data && data[0]?.ok) {
            this.mensajeExito.set(data[0].mensaje);
            const dia = this.diaSeleccionado();
            if (dia) await this.cargarSesionesDia(dia.fecha);
        } else { this.error.set(data?.[0]?.mensaje || 'Error.'); }
    } catch (err: any) { this.error.set(err.message); } finally { this.guardando.set(false); }
}

  async salirListaEspera(sesionId: number) {
    const uid = this.userId();
    if (!uid) return;
    this.guardando.set(true);
    try {
        const { data, error } = await supabase().rpc('quitar_lista_espera', { p_usuario_id: uid, p_sesion_id: sesionId });
        if (error) throw error;
        if (data && data[0]?.ok) {
            this.mensajeExito.set(data[0].mensaje);
            const dia = this.diaSeleccionado();
            if (dia) await this.cargarSesionesDia(dia.fecha);
        } else { this.error.set(data?.[0]?.mensaje || 'Error.'); }
    } catch (err: any) { this.error.set(err.message); } finally { this.guardando.set(false); }
}
