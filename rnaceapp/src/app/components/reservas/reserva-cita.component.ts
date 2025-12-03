// src/app/reservas/reserva-cita.component.ts
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { supabase } from '../../core/supabase.client';
import { AuthService } from '../../core/auth.service';

type Modalidad = 'focus' | 'reducido';

interface SesionDB {
  sesion_id: number;
  fecha_inicio: string;
  fecha_fin: string;
  modalidad: string;
  capacidad: number;
  reservas_activas: number;
  plazas_disponibles: number;
  estado: string;
  fecha: string;
  hora: string;
  dia_semana: number;
}

interface Sesion {
  id: number;
  fecha_inicio: string;
  fecha_fin: string;
  modalidad: Modalidad;
  capacidad: number;
  reservas_activas: number;
  plazas_disponibles: number;
  estado: 'disponible' | 'completa' | 'pasada' | 'cancelada';
  fecha: string;
  hora: string;
  dia_semana: number;
}

interface DiaAgrupado {
  fecha: string;
  fechaFormateada: string;
  diaNombre: string;
  sesiones: Sesion[];
}

interface CuposUsuario {
  tipo_grupo: string;
  sesiones_focus_mes: number;
  sesiones_reducido_mes: number;
  usadas_focus_mes: number;
  usadas_reducido_mes: number;
  disponibles_focus_mes: number;
  disponibles_reducido_mes: number;
  tiene_recuperacion_focus: boolean;
  tiene_recuperacion_reducido: boolean;
}

interface ResultadoReserva {
  ok: boolean;
  mensaje: string;
  reserva_id: number | null;
}

interface ResultadoListaEspera {
  ok: boolean;
  mensaje: string;
}

@Component({
  standalone: true,
  selector: 'app-reserva-cita',
  imports: [CommonModule],
  templateUrl: './reserva-cita.component.html',
  styleUrls: ['./reserva-cita.component.scss'],
})
export class ReservaCitaComponent implements OnInit {
  private router = inject(Router);
  private auth = inject(AuthService);

  // Estado de carga
  cargando = signal(true);
  error = signal<string | null>(null);
  guardando = signal(false);
  mensajeExito = signal<string | null>(null);

  // Datos
  modalidad = signal<Modalidad>('focus');
  sesiones = signal<Sesion[]>([]);
  cupos = signal<CuposUsuario | null>(null);
  mesActual = signal({ anio: new Date().getFullYear(), mes: new Date().getMonth() + 1 });
  mesAbierto = signal(false);

  // Selección
  sesionSeleccionada = signal<Sesion | null>(null);
  usarRecuperacion = signal(false);

  // Computed
  sesionesFiltradas = computed(() => {
    const mod = this.modalidad();
    return this.sesiones().filter((s) => s.modalidad === mod);
  });

  diasAgrupados = computed(() => {
    const sesiones = this.sesionesFiltradas();
    const diasMap = new Map<string, DiaAgrupado>();

    for (const sesion of sesiones) {
      if (!diasMap.has(sesion.fecha)) {
        diasMap.set(sesion.fecha, {
          fecha: sesion.fecha,
          fechaFormateada: this.formatearFecha(sesion.fecha),
          diaNombre: this.obtenerNombreDia(sesion.dia_semana),
          sesiones: [],
        });
      }
      diasMap.get(sesion.fecha)!.sesiones.push(sesion);
    }

    // Ordenar sesiones dentro de cada día por hora
    for (const dia of diasMap.values()) {
      dia.sesiones.sort((a, b) => a.hora.localeCompare(b.hora));
    }

    // Ordenar días por fecha
    return Array.from(diasMap.values()).sort((a, b) => a.fecha.localeCompare(b.fecha));
  });

  cuposDisponibles = computed(() => {
    const c = this.cupos();
    const mod = this.modalidad();
    if (!c) return { disponibles: 0, total: 0, usadas: 0, tieneRecuperacion: false };

    if (mod === 'focus') {
      return {
        disponibles: c.disponibles_focus_mes,
        total: c.sesiones_focus_mes,
        usadas: c.usadas_focus_mes,
        tieneRecuperacion: c.tiene_recuperacion_focus,
      };
    } else {
      return {
        disponibles: c.disponibles_reducido_mes,
        total: c.sesiones_reducido_mes,
        usadas: c.usadas_reducido_mes,
        tieneRecuperacion: c.tiene_recuperacion_reducido,
      };
    }
  });

  puedeReservar = computed(() => {
    const cupos = this.cuposDisponibles();
    return cupos.disponibles > 0 || cupos.tieneRecuperacion;
  });

  nombreMes = computed(() => {
    const { anio, mes } = this.mesActual();
    const fecha = new Date(anio, mes - 1, 1);
    return fecha.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  });

  ngOnInit() {
    this.cargarDatos();
  }

  private async cargarDatos() {
    this.cargando.set(true);
    this.error.set(null);

    try {
      const userId = this.auth.userId();
      if (!userId) {
        this.error.set('No has iniciado sesión.');
        return;
      }

      const { anio, mes } = this.mesActual();
      const client = supabase();

      // 1. Verificar si el mes está abierto
      const { data: agendaData } = await client
        .from('agenda_mes')
        .select('abierto')
        .eq('anio', anio)
        .eq('mes', mes)
        .maybeSingle();

      this.mesAbierto.set(agendaData?.abierto ?? false);

      if (!this.mesAbierto()) {
        this.error.set('El mes actual no está abierto para reservas. Contacta con tu centro.');
        return;
      }

      // 2. Cargar cupos del usuario
      const { data: cuposData, error: cuposError } = await client
        .rpc('obtener_cupos_usuario', {
          p_usuario_id: userId,
          p_anio: anio,
          p_mes: mes,
        })
        .single();

      if (cuposError) {
        console.error('Error cargando cupos:', cuposError);
        this.error.set('Error al cargar tu información de cupos.');
        return;
      }

      this.cupos.set(cuposData as CuposUsuario);

      // 3. Cargar sesiones del mes
      const inicioMes = `${anio}-${mes.toString().padStart(2, '0')}-01`;
      const finMes = new Date(anio, mes, 0).toISOString().split('T')[0];

      const { data: sesionesData, error: sesionesError } = await client
        .from('vista_sesiones_disponibilidad')
        .select('*')
        .gte('fecha', inicioMes)
        .lte('fecha', finMes)
        .neq('estado', 'cancelada')
        .neq('estado', 'pasada')
        .order('fecha_inicio', { ascending: true });

      if (sesionesError) {
        console.error('Error cargando sesiones:', sesionesError);
        this.error.set('Error al cargar las sesiones disponibles.');
        return;
      }

      // Mapear datos con tipo correcto
      const sesionesTyped: Sesion[] = ((sesionesData as SesionDB[]) || []).map((s) => ({
        id: s.sesion_id,
        fecha_inicio: s.fecha_inicio,
        fecha_fin: s.fecha_fin,
        modalidad: s.modalidad as Modalidad,
        capacidad: s.capacidad,
        reservas_activas: s.reservas_activas,
        plazas_disponibles: s.plazas_disponibles,
        estado: s.estado as Sesion['estado'],
        fecha: s.fecha,
        hora: s.hora,
        dia_semana: s.dia_semana,
      }));

      this.sesiones.set(sesionesTyped);
    } catch (err) {
      console.error('Error inesperado:', err);
      this.error.set('Ha ocurrido un error inesperado.');
    } finally {
      this.cargando.set(false);
    }
  }

  selectModalidad(mod: Modalidad) {
    if (this.modalidad() === mod) return;
    this.modalidad.set(mod);
    this.sesionSeleccionada.set(null);
    this.usarRecuperacion.set(false);
  }

  selectSesion(sesion: Sesion) {
    if (sesion.estado !== 'disponible') return;

    if (this.sesionSeleccionada()?.id === sesion.id) {
      this.sesionSeleccionada.set(null);
    } else {
      this.sesionSeleccionada.set(sesion);
    }
    this.usarRecuperacion.set(false);
  }

  toggleRecuperacion() {
    this.usarRecuperacion.set(!this.usarRecuperacion());
  }

  isSelected(sesion: Sesion): boolean {
    return this.sesionSeleccionada()?.id === sesion.id;
  }

  async onConfirmar() {
    const sesion = this.sesionSeleccionada();
    if (!sesion) return;

    const userId = this.auth.userId();
    if (!userId) {
      this.error.set('No has iniciado sesión.');
      return;
    }

    this.guardando.set(true);
    this.error.set(null);
    this.mensajeExito.set(null);

    try {
      const client = supabase();

      // Llamar a la función crear_reserva
      const { data, error } = await client
        .rpc('crear_reserva', {
          p_usuario_id: userId,
          p_sesion_id: sesion.id,
          p_es_recuperacion: this.usarRecuperacion(),
        })
        .single();

      if (error) {
        console.error('Error creando reserva:', error);
        this.error.set(error.message || 'Error al crear la reserva.');
        return;
      }

      const resultado = data as ResultadoReserva;

      if (!resultado.ok) {
        this.error.set(resultado.mensaje);
        return;
      }

      this.mensajeExito.set('¡Reserva confirmada! ' + resultado.mensaje);
      this.sesionSeleccionada.set(null);
      this.usarRecuperacion.set(false);

      // Recargar datos
      await this.cargarDatos();
    } catch (err) {
      console.error('Error inesperado:', err);
      this.error.set('Ha ocurrido un error al procesar tu reserva.');
    } finally {
      this.guardando.set(false);
    }
  }

  async onListaEspera() {
    const sesion = this.sesionSeleccionada();
    if (!sesion) return;

    const userId = this.auth.userId();
    if (!userId) return;

    this.guardando.set(true);
    this.error.set(null);

    try {
      const client = supabase();

      const { data, error } = await client
        .rpc('agregar_lista_espera', {
          p_usuario_id: userId,
          p_sesion_id: sesion.id,
        })
        .single();

      if (error) {
        this.error.set(error.message || 'Error al añadirte a la lista de espera.');
        return;
      }

      const resultado = data as ResultadoListaEspera;

      if (!resultado.ok) {
        this.error.set(resultado.mensaje);
        return;
      }

      this.mensajeExito.set('Te has añadido a la lista de espera. Te avisaremos si hay hueco.');
      this.sesionSeleccionada.set(null);
    } catch (err) {
      console.error('Error lista espera:', err);
      this.error.set('Error al procesar tu solicitud.');
    } finally {
      this.guardando.set(false);
    }
  }

  volver() {
    this.router.navigateByUrl('/dashboard');
  }

  // Helpers (públicos para usar en template)
  formatearFecha(fecha: string): string {
    const d = new Date(fecha + 'T00:00:00');
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  }

  obtenerNombreDia(diaSemana: number): string {
    const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    return dias[diaSemana] || '';
  }

  getEstadoClase(sesion: Sesion): string {
    if (sesion.estado === 'completa') return 'slot-btn--completa';
    if (sesion.estado === 'pasada') return 'slot-btn--pasada';
    if (this.isSelected(sesion)) return 'slot-btn--selected';
    return '';
  }

  getEstadoTexto(sesion: Sesion): string {
    if (sesion.estado === 'completa') return 'Completa';
    if (sesion.estado === 'pasada') return 'Pasada';
    return `${sesion.plazas_disponibles}/${sesion.capacidad}`;
  }
}
