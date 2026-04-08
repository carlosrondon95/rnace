// src/app/components/registro-actividad/registro-actividad.component.ts
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { supabase } from '../../core/supabase.client';

type TipoAccion = 'todos' | 'admin_add_sesion' | 'admin_cancel_reserva' | 'cliente_cancel_reserva' | 'cliente_usa_recuperacion' | 'admin_mueve_reserva' | 'cliente_cambio_turno';
type FiltroGrupo = 'todos' | 'focus' | 'reducido';

interface RegistroCambio {
  id: number;
  tipo: string;
  usuario_id: string;
  usuario_nombre: string;
  descripcion: string;
  detalle: Record<string, unknown> | null;
  creado_en: string;
  // Extraídos del detalle JSONB
  modalidad: string | null;
  hora: string | null;
  fecha_sesion: string | null;
}

interface TurnoRegistros {
  hora: string;
  registros: RegistroCambio[];
}

interface GrupoRegistros {
  grupo: string;
  nombre: string;
  color: string;
  icono: string;
  totalRegistros: number;
  turnos: TurnoRegistros[];
}

@Component({
  standalone: true,
  selector: 'app-registro-actividad',
  imports: [CommonModule, FormsModule],
  templateUrl: './registro-actividad.component.html',
  styleUrls: ['./registro-actividad.component.scss'],
})
export class RegistroActividadComponent implements OnInit {
  private router = inject(Router);

  cargando = signal(true);
  error = signal<string | null>(null);

  // Datos crudos
  registros = signal<RegistroCambio[]>([]);
  totalRegistros = signal(0);
  limit = 100;
  offset = signal(0);
  hayMas = signal(false);
  cargandoMas = signal(false);

  // Filtros
  filtroGrupo = signal<FiltroGrupo>('todos');
  filtroAccion = signal<TipoAccion>('todos');
  filtroBusqueda = signal('');
  filtroFechaInicio = signal('');
  filtroFechaFin = signal('');

  // Opciones de filtro
  opcionesGrupo: { value: FiltroGrupo; label: string }[] = [
    { value: 'todos', label: 'Todos los grupos' },
    { value: 'focus', label: 'Focus' },
    { value: 'reducido', label: 'Reducido' },
  ];

  opcionesAccion: { value: TipoAccion; label: string }[] = [
    { value: 'todos', label: 'Todas las acciones' },
    { value: 'cliente_cancel_reserva', label: 'Cancelaciones cliente' },
    { value: 'admin_cancel_reserva', label: 'Cancelaciones admin' },
    { value: 'cliente_cambio_turno', label: 'Cambios de turno' },
    { value: 'cliente_usa_recuperacion', label: 'Recuperaciones' },
    { value: 'admin_add_sesion', label: 'Altas manuales' },
    { value: 'admin_mueve_reserva', label: 'Movimientos admin' },
  ];

  // Estado de turnos expandidos (clave = "grupo:hora")
  turnosExpandidos = signal<Set<string>>(new Set());

  // Registros agrupados por grupo > turno (computed)
  gruposRegistros = computed((): GrupoRegistros[] => {
    const regs = this.registrosFiltrados();

    const gruposConfig: Record<string, { nombre: string; color: string; icono: string }> = {
      focus: { nombre: 'Focus', color: '#60a5fa', icono: 'fitness_center' },
      reducido: { nombre: 'Reducido', color: '#a78bfa', icono: 'groups' },
      otro: { nombre: 'Otros', color: '#b8b29e', icono: 'info' },
    };

    // Nivel 1: agrupar por modalidad
    const mapaGrupos = new Map<string, RegistroCambio[]>();
    for (const reg of regs) {
      const mod = reg.modalidad?.toLowerCase() || 'otro';
      const key = mod === 'focus' || mod === 'reducido' ? mod : 'otro';
      if (!mapaGrupos.has(key)) mapaGrupos.set(key, []);
      mapaGrupos.get(key)!.push(reg);
    }

    const orden = ['focus', 'reducido', 'otro'];
    const result: GrupoRegistros[] = [];

    for (const key of orden) {
      const regsGrupo = mapaGrupos.get(key);
      if (regsGrupo && regsGrupo.length > 0) {
        const cfg = gruposConfig[key];

        // Nivel 2: agrupar por hora dentro de cada grupo
        const mapaTurnos = new Map<string, RegistroCambio[]>();
        for (const reg of regsGrupo) {
          const hora = reg.hora?.slice(0, 5) || 'Sin hora';
          if (!mapaTurnos.has(hora)) mapaTurnos.set(hora, []);
          mapaTurnos.get(hora)!.push(reg);
        }

        // Ordenar turnos por hora
        const turnos: TurnoRegistros[] = Array.from(mapaTurnos.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([hora, registros]) => ({ hora, registros }));

        result.push({
          grupo: key,
          nombre: cfg.nombre,
          color: cfg.color,
          icono: cfg.icono,
          totalRegistros: regsGrupo.length,
          turnos,
        });
      }
    }

    return result;
  });

  toggleTurno(grupo: string, hora: string) {
    const key = `${grupo}:${hora}`;
    this.turnosExpandidos.update(set => {
      const nuevo = new Set(set);
      if (nuevo.has(key)) {
        nuevo.delete(key);
      } else {
        nuevo.add(key);
      }
      return nuevo;
    });
  }

  isTurnoExpandido(grupo: string, hora: string): boolean {
    return this.turnosExpandidos().has(`${grupo}:${hora}`);
  }

  expandirTodosGrupo(grupo: string, turnos: TurnoRegistros[]) {
    this.turnosExpandidos.update(set => {
      const nuevo = new Set(set);
      for (const t of turnos) {
        nuevo.add(`${grupo}:${t.hora}`);
      }
      return nuevo;
    });
  }

  colapsarTodosGrupo(grupo: string, turnos: TurnoRegistros[]) {
    this.turnosExpandidos.update(set => {
      const nuevo = new Set(set);
      for (const t of turnos) {
        nuevo.delete(`${grupo}:${t.hora}`);
      }
      return nuevo;
    });
  }

  // Filtrado local
  registrosFiltrados = computed(() => {
    let regs = this.registros();

    const grupo = this.filtroGrupo();
    if (grupo !== 'todos') {
      regs = regs.filter(r => r.modalidad?.toLowerCase() === grupo);
    }

    const accion = this.filtroAccion();
    if (accion !== 'todos') {
      regs = regs.filter(r => r.tipo === accion);
    }

    const busqueda = this.filtroBusqueda().toLowerCase().trim();
    if (busqueda) {
      regs = regs.filter(r =>
        r.usuario_nombre.toLowerCase().includes(busqueda) ||
        r.descripcion.toLowerCase().includes(busqueda)
      );
    }

    return regs;
  });

  // Contadores
  stats = computed(() => {
    const regs = this.registrosFiltrados();
    return {
      total: regs.length,
      cancelaciones: regs.filter(r => r.tipo.includes('cancel')).length,
      cambios: regs.filter(r => r.tipo === 'cliente_cambio_turno' || r.tipo === 'admin_mueve_reserva').length,
      altas: regs.filter(r => r.tipo === 'admin_add_sesion' || r.tipo === 'cliente_usa_recuperacion').length,
    };
  });

  ngOnInit() {
    // Por defecto: últimos 7 días
    const hoy = new Date();
    const hace7 = new Date();
    hace7.setDate(hace7.getDate() - 7);
    this.filtroFechaFin.set(this.toDateInput(hoy));
    this.filtroFechaInicio.set(this.toDateInput(hace7));

    this.cargarRegistros();
  }

  async cargarRegistros() {
    this.cargando.set(true);
    this.error.set(null);
    this.offset.set(0);

    try {
      const registros = await this.fetchRegistros(0);
      this.registros.set(registros);
      this.hayMas.set(registros.length >= this.limit);
    } catch (err) {
      console.error('Error cargando registros:', err);
      this.error.set('Error al cargar los registros de actividad.');
    } finally {
      this.cargando.set(false);
    }
  }

  async cargarMas() {
    this.cargandoMas.set(true);
    const nuevoOffset = this.offset() + this.limit;
    this.offset.set(nuevoOffset);

    try {
      const nuevos = await this.fetchRegistros(nuevoOffset);
      this.registros.update(prev => [...prev, ...nuevos]);
      this.hayMas.set(nuevos.length >= this.limit);
    } catch (err) {
      console.error('Error cargando más registros:', err);
    } finally {
      this.cargandoMas.set(false);
    }
  }

  private async fetchRegistros(offset: number): Promise<RegistroCambio[]> {
    let query = supabase()
      .from('registro_cambios')
      .select('*')
      .order('creado_en', { ascending: false })
      .range(offset, offset + this.limit - 1);

    const fechaInicio = this.filtroFechaInicio();
    const fechaFin = this.filtroFechaFin();

    if (fechaInicio) {
      query = query.gte('creado_en', fechaInicio + 'T00:00:00');
    }
    if (fechaFin) {
      query = query.lte('creado_en', fechaFin + 'T23:59:59');
    }

    const { data, error } = await query;

    if (error) throw error;

    return (data || []).map((r: Record<string, unknown>) => {
      const detalle = r['detalle'] as Record<string, unknown> | null;
      return {
        id: r['id'] as number,
        tipo: r['tipo'] as string,
        usuario_id: r['usuario_id'] as string,
        usuario_nombre: r['usuario_nombre'] as string,
        descripcion: r['descripcion'] as string,
        detalle,
        creado_en: r['creado_en'] as string,
        modalidad: (detalle?.['modalidad'] as string) || this.extraerModalidadDeDescripcion(r['descripcion'] as string),
        hora: (detalle?.['hora'] as string) || null,
        fecha_sesion: (detalle?.['fecha'] as string) || (detalle?.['fecha_nueva'] as string) || null,
      };
    });
  }

  private extraerModalidadDeDescripcion(desc: string): string | null {
    if (!desc) return null;
    const lower = desc.toLowerCase();
    if (lower.includes('focus')) return 'focus';
    if (lower.includes('reducido')) return 'reducido';
    return null;
  }

  // Aplicar filtros de fecha (recarga desde servidor)
  aplicarFiltros() {
    this.cargarRegistros();
  }

  // Reset
  limpiarFiltros() {
    const hoy = new Date();
    const hace7 = new Date();
    hace7.setDate(hace7.getDate() - 7);
    this.filtroFechaFin.set(this.toDateInput(hoy));
    this.filtroFechaInicio.set(this.toDateInput(hace7));
    this.filtroGrupo.set('todos');
    this.filtroAccion.set('todos');
    this.filtroBusqueda.set('');
    this.cargarRegistros();
  }

  // Helpers de formato
  formatFecha(fecha: string): string {
    const d = new Date(fecha);
    return d.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  formatHora(fecha: string): string {
    const d = new Date(fecha);
    return d.toLocaleTimeString('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  formatFechaCompleta(fecha: string): string {
    const d = new Date(fecha);
    return `${this.formatFecha(fecha)} ${this.formatHora(fecha)}`;
  }

  formatFechaSesion(fecha: string | null): string {
    if (!fecha) return '';
    // Puede venir como YYYY-MM-DD
    return fecha.split('-').reverse().join('/');
  }

  formatDescripcion(desc: string): string {
    if (!desc) return '';
    return desc.replace(/\((\d{4})-(\d{2})-(\d{2})\)/g, '($3/$2/$1)');
  }

  getIconoAccion(tipo: string): string {
    switch (tipo) {
      case 'admin_add_sesion': return 'person_add';
      case 'admin_cancel_reserva': return 'person_remove';
      case 'cliente_cancel_reserva': return 'event_busy';
      case 'cliente_usa_recuperacion': return 'event_available';
      case 'admin_mueve_reserva': return 'move_down';
      case 'cliente_cambio_turno': return 'sync_alt';
      default: return 'info';
    }
  }

  getColorAccion(tipo: string): string {
    switch (tipo) {
      case 'admin_add_sesion':
      case 'cliente_usa_recuperacion':
        return 'accion--alta';
      case 'admin_cancel_reserva':
      case 'cliente_cancel_reserva':
        return 'accion--baja';
      case 'admin_mueve_reserva':
      case 'cliente_cambio_turno':
        return 'accion--cambio';
      default: return '';
    }
  }

  getNombreAccion(tipo: string): string {
    switch (tipo) {
      case 'admin_add_sesion': return 'Alta manual';
      case 'admin_cancel_reserva': return 'Cancelación admin';
      case 'cliente_cancel_reserva': return 'Cancelación';
      case 'cliente_usa_recuperacion': return 'Recuperación';
      case 'admin_mueve_reserva': return 'Movimiento admin';
      case 'cliente_cambio_turno': return 'Cambio de turno';
      default: return tipo;
    }
  }

  getEtiquetaOrigen(tipo: string): string {
    if (tipo.startsWith('admin_')) return 'Admin';
    if (tipo.startsWith('cliente_')) return 'Cliente';
    return '';
  }

  trackById(_i: number, r: RegistroCambio): number {
    return r.id;
  }

  private toDateInput(d: Date): string {
    return d.toISOString().split('T')[0];
  }

  volver() {
    this.router.navigateByUrl('/dashboard');
  }
}
