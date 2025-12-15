// src/app/components/reservas/reserva-cita.component.ts
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { supabase } from '../../core/supabase.client';
import { AuthService } from '../../core/auth.service';

type Modalidad = 'focus' | 'reducido';
type TipoGrupo = 'focus' | 'reducido' | 'hibrido' | 'especial';

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
  tipo_grupo: TipoGrupo;
  sesiones_focus_mes: number;
  sesiones_reducido_mes: number;
  usadas_focus_mes: number;
  usadas_reducido_mes: number;
  disponibles_focus_mes: number;
  disponibles_reducido_mes: number;
  tiene_recuperacion_focus: boolean;
  tiene_recuperacion_reducido: boolean;
}

interface PlanUsuario {
  tipo_grupo: TipoGrupo;
  clases_focus_semana: number;
  clases_reducido_semana: number;
  sesiones_fijas_mes_focus: number | null;
  sesiones_fijas_mes_reducido: number | null;
  tipo_cuota: string;
  activo: boolean;
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
  plan = signal<PlanUsuario | null>(null);
  mesActual = signal({ anio: new Date().getFullYear(), mes: new Date().getMonth() + 1 });
  mesAbierto = signal(false);

  // Selección
  sesionSeleccionada = signal<Sesion | null>(null);
  usarRecuperacion = signal(false);

  // Computed: tipo de grupo del usuario
  tipoGrupo = computed<TipoGrupo>(() => {
    const c = this.cupos();
    return (c?.tipo_grupo as TipoGrupo) || 'focus';
  });

  // Computed: modalidades disponibles según el plan
  modalidadesDisponibles = computed<Modalidad[]>(() => {
    const tipo = this.tipoGrupo();
    switch (tipo) {
      case 'focus':
        return ['focus'];
      case 'reducido':
        return ['reducido'];
      case 'hibrido':
      case 'especial':
        return ['focus', 'reducido'];
      default:
        return ['focus'];
    }
  });

  // Computed: si puede cambiar de modalidad
  puedeToggleModalidad = computed(() => {
    return this.modalidadesDisponibles().length > 1;
  });

  // Computed: sesiones filtradas por modalidad
  sesionesFiltradas = computed(() => {
    const mod = this.modalidad();
    return this.sesiones().filter((s) => s.modalidad === mod);
  });

  // Computed: días agrupados
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

    for (const dia of diasMap.values()) {
      dia.sesiones.sort((a, b) => a.hora.localeCompare(b.hora));
    }

    return Array.from(diasMap.values()).sort((a, b) => a.fecha.localeCompare(b.fecha));
  });

  // Computed: cupos de la modalidad actual
  cuposModalidadActual = computed(() => {
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

  // Computed: info de cupos para mostrar (según tipo de grupo)
  infoCupos = computed(() => {
    const c = this.cupos();
    const tipo = this.tipoGrupo();

    if (!c) return null;

    switch (tipo) {
      case 'focus':
        return {
          tipo: 'focus' as const,
          titulo: 'Clases Focus',
          usadas: c.usadas_focus_mes,
          total: c.sesiones_focus_mes,
          disponibles: c.disponibles_focus_mes,
          recuperacion: c.tiene_recuperacion_focus,
        };

      case 'reducido':
        return {
          tipo: 'reducido' as const,
          titulo: 'Clases Reducido',
          usadas: c.usadas_reducido_mes,
          total: c.sesiones_reducido_mes,
          disponibles: c.disponibles_reducido_mes,
          recuperacion: c.tiene_recuperacion_reducido,
        };

      case 'hibrido':
        return {
          tipo: 'hibrido' as const,
          focus: {
            usadas: c.usadas_focus_mes,
            total: c.sesiones_focus_mes,
            disponibles: c.disponibles_focus_mes,
            recuperacion: c.tiene_recuperacion_focus,
          },
          reducido: {
            usadas: c.usadas_reducido_mes,
            total: c.sesiones_reducido_mes,
            disponibles: c.disponibles_reducido_mes,
            recuperacion: c.tiene_recuperacion_reducido,
          },
        };

      case 'especial': {
        const planData = this.plan();
        return {
          tipo: 'especial' as const,
          focus: {
            usadas: c.usadas_focus_mes,
            total: planData?.sesiones_fijas_mes_focus || c.sesiones_focus_mes,
            disponibles: c.disponibles_focus_mes,
            recuperacion: c.tiene_recuperacion_focus,
          },
          reducido: {
            usadas: c.usadas_reducido_mes,
            total: planData?.sesiones_fijas_mes_reducido || c.sesiones_reducido_mes,
            disponibles: c.disponibles_reducido_mes,
            recuperacion: c.tiene_recuperacion_reducido,
          },
        };
      }

      default:
        return null;
    }
  });

  // Computed: si puede reservar en la modalidad actual
  puedeReservar = computed(() => {
    const cupos = this.cuposModalidadActual();
    return cupos.disponibles > 0 || cupos.tieneRecuperacion;
  });

  nombreMes = computed(() => {
    const { anio, mes } = this.mesActual();
    const fecha = new Date(anio, mes - 1, 1);
    const nombreMes = fecha.toLocaleDateString('es-ES', { month: 'long' });
    return `${nombreMes} ${anio}`;
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

      // 2. Cargar plan del usuario
      const { data: planData } = await client
        .from('plan_usuario')
        .select('*')
        .eq('usuario_id', userId)
        .maybeSingle();

      if (planData) {
        this.plan.set(planData as PlanUsuario);
      }

      // 3. Cargar cupos del usuario
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

      // 4. Establecer modalidad inicial según tipo de grupo
      const tipoGrupo = (cuposData as CuposUsuario).tipo_grupo as TipoGrupo;
      if (tipoGrupo === 'reducido') {
        this.modalidad.set('reducido');
      } else {
        this.modalidad.set('focus');
      }

      // 5. Cargar sesiones del mes
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
    // Solo permitir cambiar si tiene acceso a esa modalidad
    if (!this.modalidadesDisponibles().includes(mod)) return;
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

  // Helpers
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

  getNombreModalidad(mod: Modalidad): string {
    return mod === 'focus' ? 'Focus' : 'Reducido';
  }
}
