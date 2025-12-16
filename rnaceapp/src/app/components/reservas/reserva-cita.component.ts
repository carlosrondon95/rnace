// src/app/components/reservas/reserva-cita.component.ts
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/auth.service';
import { supabase } from '../../core/supabase.client';

type Modalidad = 'focus' | 'reducido';

interface Sesion {
  id: number;
  fecha: string;
  fecha_inicio: string;
  hora: string;
  dia_semana: number;
  modalidad: Modalidad;
  capacidad: number;
  reservas_activas: number;
  plazas_disponibles: number;
  estado: 'disponible' | 'completa' | 'pasada' | 'bloqueada';
}

interface SemanaAgrupada {
  numeroSemana: number;
  fechaInicio: string;
  fechaFin: string;
  tituloSemana: string; // NUEVO: "Semana del 15 al 19"
  dias: DiaAgrupado[];
}

interface DiaAgrupado {
  fecha: string;
  diaNombre: string;
  fechaFormateada: string;
  sesiones: Sesion[];
  esFestivo: boolean;
  esFinSemana: boolean;
}

interface CuposInfo {
  tipo: 'focus' | 'reducido' | 'hibrido' | 'especial';
  titulo?: string;
  total?: number;
  usadas?: number;
  disponibles?: number;
  recuperacion?: boolean;
  focus?: { total: number; usadas: number; disponibles: number; recuperacion: boolean };
  reducido?: { total: number; usadas: number; disponibles: number; recuperacion: boolean };
}

interface PlanUsuario {
  tipo_grupo: string;
  clases_focus_semana: number;
  clases_reducido_semana: number;
  sesiones_fijas_mes_focus: number | null;
  sesiones_fijas_mes_reducido: number | null;
}

@Component({
  standalone: true,
  selector: 'app-reserva-cita',
  imports: [CommonModule, FormsModule],
  templateUrl: './reserva-cita.component.html',
  styleUrls: ['./reserva-cita.component.scss'],
})
export class ReservaCitaComponent implements OnInit {
  private router = inject(Router);
  private auth = inject(AuthService);

  cargando = signal(true);
  error = signal<string | null>(null);
  mensajeExito = signal<string | null>(null);
  guardando = signal(false);

  // Navegación de meses
  mesActual = signal({ anio: new Date().getFullYear(), mes: new Date().getMonth() + 1 });
  mesAbierto = signal(true);

  sesiones = signal<Sesion[]>([]);
  festivosMes = signal<Set<string>>(new Set());
  sesionSeleccionada = signal<Sesion | null>(null);
  modalidad = signal<Modalidad>('focus');
  usarRecuperacion = signal(false);

  // Datos del usuario
  planUsuario = signal<PlanUsuario | null>(null);
  cuposData = signal<{
    sesiones_focus_mes: number;
    sesiones_reducido_mes: number;
    usadas_focus_mes: number;
    usadas_reducido_mes: number;
    tiene_recuperacion_focus: boolean;
    tiene_recuperacion_reducido: boolean;
    tipo_grupo: string;
  } | null>(null);

  esAdmin = computed(() => this.auth.getRol() === 'admin');

  nombreMes = computed(() => {
    const { anio, mes } = this.mesActual();
    const fecha = new Date(anio, mes - 1, 1);
    const nombreMes = fecha.toLocaleDateString('es-ES', { month: 'long' });
    return `${nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1)} ${anio}`;
  });

  infoCupos = computed((): CuposInfo | null => {
    if (this.esAdmin()) return null;

    const cupos = this.cuposData();
    const plan = this.planUsuario();
    if (!cupos) return null;

    const tipo = cupos.tipo_grupo as CuposInfo['tipo'];

    if (tipo === 'focus') {
      return {
        tipo: 'focus',
        titulo: 'Clases Focus',
        total: cupos.sesiones_focus_mes,
        usadas: cupos.usadas_focus_mes,
        disponibles: Math.max(0, cupos.sesiones_focus_mes - cupos.usadas_focus_mes),
        recuperacion: cupos.tiene_recuperacion_focus,
      };
    }

    if (tipo === 'reducido') {
      return {
        tipo: 'reducido',
        titulo: 'Clases Reducido',
        total: cupos.sesiones_reducido_mes,
        usadas: cupos.usadas_reducido_mes,
        disponibles: Math.max(0, cupos.sesiones_reducido_mes - cupos.usadas_reducido_mes),
        recuperacion: cupos.tiene_recuperacion_reducido,
      };
    }

    if (tipo === 'hibrido') {
      return {
        tipo: 'hibrido',
        focus: {
          total: cupos.sesiones_focus_mes,
          usadas: cupos.usadas_focus_mes,
          disponibles: Math.max(0, cupos.sesiones_focus_mes - cupos.usadas_focus_mes),
          recuperacion: cupos.tiene_recuperacion_focus,
        },
        reducido: {
          total: cupos.sesiones_reducido_mes,
          usadas: cupos.usadas_reducido_mes,
          disponibles: Math.max(0, cupos.sesiones_reducido_mes - cupos.usadas_reducido_mes),
          recuperacion: cupos.tiene_recuperacion_reducido,
        },
      };
    }

    if (tipo === 'especial' && plan) {
      const focusTotal = plan.sesiones_fijas_mes_focus || 0;
      const reducidoTotal = plan.sesiones_fijas_mes_reducido || 0;

      return {
        tipo: 'especial',
        focus: {
          total: focusTotal,
          usadas: cupos.usadas_focus_mes,
          disponibles: Math.max(0, focusTotal - cupos.usadas_focus_mes),
          recuperacion: cupos.tiene_recuperacion_focus,
        },
        reducido: {
          total: reducidoTotal,
          usadas: cupos.usadas_reducido_mes,
          disponibles: Math.max(0, reducidoTotal - cupos.usadas_reducido_mes),
          recuperacion: cupos.tiene_recuperacion_reducido,
        },
      };
    }

    return null;
  });

  modalidadesDisponibles = computed((): Modalidad[] => {
    const cupos = this.cuposData();
    if (!cupos) return ['focus'];

    const tipo = cupos.tipo_grupo;
    if (tipo === 'focus') return ['focus'];
    if (tipo === 'reducido') return ['reducido'];
    return ['focus', 'reducido'];
  });

  // CAMBIO: agrupar por semanas (SOLO LUNES A VIERNES)
  semanasAgrupadas = computed((): SemanaAgrupada[] => {
    const mod = this.modalidad();
    const festivos = this.festivosMes();
    const sesionesFiltradas = this.sesiones().filter(
      (s) => s.modalidad === mod && s.estado !== 'pasada',
    );

    if (sesionesFiltradas.length === 0) return [];

    // Agrupar sesiones por fecha
    const sesionesPorFecha = new Map<string, Sesion[]>();
    sesionesFiltradas.forEach((sesion) => {
      const fecha = sesion.fecha;
      if (!sesionesPorFecha.has(fecha)) {
        sesionesPorFecha.set(fecha, []);
      }
      sesionesPorFecha.get(fecha)!.push(sesion);
    });

    // Obtener todas las fechas con sesiones
    const fechasConSesiones = Array.from(sesionesPorFecha.keys()).sort();

    if (fechasConSesiones.length === 0) return [];

    // Agrupar por semanas
    const semanas: SemanaAgrupada[] = [];
    let numeroSemana = 1;

    // Función para obtener el lunes de una fecha
    const getLunes = (fecha: string): Date => {
      const d = new Date(fecha + 'T12:00:00');
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      return new Date(d.setDate(diff));
    };

    // Obtener el lunes de la primera fecha con sesiones
    const primerLunes = getLunes(fechasConSesiones[0]);
    const ultimaFechaConSesion = new Date(
      fechasConSesiones[fechasConSesiones.length - 1] + 'T12:00:00',
    );

    const currentLunes = new Date(primerLunes);

    // Iterar semana por semana desde el primer lunes
    while (currentLunes <= ultimaFechaConSesion) {
      const currentViernes = new Date(currentLunes);
      currentViernes.setDate(currentViernes.getDate() + 4); // Lunes + 4 días = Viernes

      const fechaInicioSemana = currentLunes.toISOString().split('T')[0];
      const fechaFinSemana = currentViernes.toISOString().split('T')[0];

      const semanaActual: DiaAgrupado[] = [];

      // Crear solo los 5 días laborables (Lunes a Viernes)
      for (let i = 0; i < 5; i++) {
        const diaFecha = new Date(currentLunes);
        diaFecha.setDate(diaFecha.getDate() + i);
        const fechaStr = diaFecha.toISOString().split('T')[0];
        const esFestivo = festivos.has(fechaStr);

        const dia: DiaAgrupado = {
          fecha: fechaStr,
          diaNombre: diaFecha.toLocaleDateString('es-ES', { weekday: 'short' }),
          fechaFormateada: diaFecha.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }),
          sesiones: sesionesPorFecha.get(fechaStr) || [],
          esFestivo,
          esFinSemana: false, // Nunca es fin de semana ya que solo mostramos L-V
        };

        semanaActual.push(dia);
      }

      // Crear título dinámico de la semana: "Semana del 15 al 19"
      const diaInicio = currentLunes.getDate();
      const diaFin = currentViernes.getDate();
      const tituloSemana = `Semana del ${diaInicio} al ${diaFin}`;

      semanas.push({
        numeroSemana,
        fechaInicio: fechaInicioSemana,
        fechaFin: fechaFinSemana,
        tituloSemana,
        dias: semanaActual,
      });

      numeroSemana++;
      currentLunes.setDate(currentLunes.getDate() + 7);
    }

    return semanas;
  });

  cuposModalidadActual = computed(() => {
    const cupos = this.cuposData();
    if (!cupos) {
      return { disponibles: 0, tieneRecuperacion: false };
    }

    const mod = this.modalidad();
    const info = this.infoCupos();

    if (!info) return { disponibles: 0, tieneRecuperacion: false };

    if (info.tipo === 'focus' || info.tipo === 'reducido') {
      return {
        disponibles: info.disponibles || 0,
        tieneRecuperacion: info.recuperacion || false,
      };
    }

    if (info.tipo === 'hibrido' || info.tipo === 'especial') {
      if (mod === 'focus') {
        return {
          disponibles: info.focus?.disponibles || 0,
          tieneRecuperacion: info.focus?.recuperacion || false,
        };
      } else {
        return {
          disponibles: info.reducido?.disponibles || 0,
          tieneRecuperacion: info.reducido?.recuperacion || false,
        };
      }
    }

    return { disponibles: 0, tieneRecuperacion: false };
  });

  async ngOnInit() {
    await this.cargarDatos();
  }

  async cargarDatos() {
    this.cargando.set(true);
    this.error.set(null);

    try {
      const { anio, mes } = this.mesActual();

      // Verificar que el mes está abierto
      const { data: agendaData } = await supabase()
        .from('agenda_mes')
        .select('abierto')
        .eq('anio', anio)
        .eq('mes', mes)
        .maybeSingle();

      const abierto = agendaData?.abierto ?? false;
      this.mesAbierto.set(abierto);

      if (!abierto && !this.esAdmin()) {
        this.error.set('Este mes aún no está disponible para reservas.');
        this.sesiones.set([]);
        this.cargando.set(false);
        return;
      }

      // Cargar festivos
      await this.cargarFestivos();

      // Cargar sesiones
      await this.cargarSesiones();

      // Cargar cupos si es cliente
      if (!this.esAdmin()) {
        await this.cargarCuposUsuario();
      }
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error al cargar los datos.');
    } finally {
      this.cargando.set(false);
    }
  }

  async cargarFestivos() {
    const { anio, mes } = this.mesActual();
    const primerDia = `${anio}-${mes.toString().padStart(2, '0')}-01`;
    const ultimoDia = new Date(anio, mes, 0).toISOString().split('T')[0];

    const { data } = await supabase()
      .from('festivos')
      .select('fecha')
      .gte('fecha', primerDia)
      .lte('fecha', ultimoDia);

    const festivos = new Set<string>();
    (data || []).forEach((f) => festivos.add(f.fecha));
    this.festivosMes.set(festivos);
  }

  async cargarSesiones() {
    const { anio, mes } = this.mesActual();
    const festivos = this.festivosMes();

    const primerDia = `${anio}-${mes.toString().padStart(2, '0')}-01`;
    const ultimoDia = new Date(anio, mes, 0).toISOString().split('T')[0];

    const { data, error } = await supabase()
      .from('vista_sesiones_disponibilidad')
      .select('*')
      .gte('fecha', primerDia)
      .lte('fecha', ultimoDia)
      .order('fecha_inicio', { ascending: true });

    if (error) {
      console.error('Error cargando sesiones:', error);
      this.sesiones.set([]);
      return;
    }

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const sesiones: Sesion[] = (data || []).map(
      (s: {
        sesion_id: number;
        fecha: string;
        fecha_inicio: string;
        hora: string;
        dia_semana: number;
        modalidad: string;
        capacidad: number;
        reservas_activas: number;
        plazas_disponibles: number;
        estado: string;
      }) => {
        const fechaSesion = new Date(s.fecha_inicio);
        const esPasada = fechaSesion < hoy;
        const esFestivo = festivos.has(s.fecha);

        let estado: Sesion['estado'];
        if (esPasada) {
          estado = 'pasada';
        } else if (esFestivo) {
          estado = 'bloqueada';
        } else if (s.plazas_disponibles === 0) {
          estado = 'completa';
        } else {
          estado = 'disponible';
        }

        return {
          id: s.sesion_id,
          fecha: s.fecha,
          fecha_inicio: s.fecha_inicio,
          hora: s.hora,
          dia_semana: s.dia_semana,
          modalidad: s.modalidad as Modalidad,
          capacidad: s.capacidad,
          reservas_activas: s.reservas_activas,
          plazas_disponibles: s.plazas_disponibles,
          estado,
        };
      },
    );

    this.sesiones.set(sesiones);
  }

  async cargarCuposUsuario() {
    const userId = this.auth.userId();
    if (!userId) return;

    const { anio, mes } = this.mesActual();

    // Cargar plan del usuario
    const { data: planData } = await supabase()
      .from('plan_usuario')
      .select(
        'tipo_grupo, clases_focus_semana, clases_reducido_semana, sesiones_fijas_mes_focus, sesiones_fijas_mes_reducido',
      )
      .eq('usuario_id', userId)
      .single();

    if (planData) {
      this.planUsuario.set(planData as PlanUsuario);

      // Establecer modalidad inicial
      if (planData.tipo_grupo === 'reducido') {
        this.modalidad.set('reducido');
      } else {
        this.modalidad.set('focus');
      }
    }

    // Cargar cupos
    const { data: cuposData } = await supabase().rpc('obtener_cupos_usuario', {
      p_usuario_id: userId,
      p_anio: anio,
      p_mes: mes,
    });

    if (cuposData && cuposData.length > 0) {
      this.cuposData.set(cuposData[0]);
    }
  }

  // Navegación de meses
  mesAnterior() {
    const { anio, mes } = this.mesActual();
    if (mes === 1) {
      this.mesActual.set({ anio: anio - 1, mes: 12 });
    } else {
      this.mesActual.set({ anio, mes: mes - 1 });
    }
    this.sesionSeleccionada.set(null);
    this.cargarDatos();
  }

  mesSiguiente() {
    const { anio, mes } = this.mesActual();
    if (mes === 12) {
      this.mesActual.set({ anio: anio + 1, mes: 1 });
    } else {
      this.mesActual.set({ anio, mes: mes + 1 });
    }
    this.sesionSeleccionada.set(null);
    this.cargarDatos();
  }

  selectModalidad(mod: Modalidad) {
    this.modalidad.set(mod);
    this.sesionSeleccionada.set(null);
    this.usarRecuperacion.set(false);
  }

  selectSesion(sesion: Sesion) {
    if (this.esAdmin()) return;
    if (sesion.estado === 'pasada' || sesion.estado === 'bloqueada') return;

    if (this.sesionSeleccionada()?.id === sesion.id) {
      this.sesionSeleccionada.set(null);
    } else {
      this.sesionSeleccionada.set(sesion);
      this.usarRecuperacion.set(false);
    }
  }

  toggleRecuperacion() {
    this.usarRecuperacion.update((v) => !v);
  }

  puedeToggleModalidad(): boolean {
    return this.modalidadesDisponibles().length > 1;
  }

  puedeReservar(): boolean {
    if (this.esAdmin()) return false;
    const cupos = this.cuposModalidadActual();
    return cupos.disponibles > 0 || cupos.tieneRecuperacion;
  }

  async onConfirmar() {
    const sesion = this.sesionSeleccionada();
    if (!sesion || this.esAdmin()) return;

    const userId = this.auth.userId();
    if (!userId) return;

    this.guardando.set(true);
    this.error.set(null);
    this.mensajeExito.set(null);

    try {
      const { data, error } = await supabase().rpc('crear_reserva', {
        p_usuario_id: userId,
        p_sesion_id: sesion.id,
        p_es_recuperacion: this.usarRecuperacion(),
      });

      if (error) {
        this.error.set(error.message);
        return;
      }

      if (data && data.length > 0) {
        const resultado = data[0];
        if (resultado.ok) {
          this.mensajeExito.set('¡Reserva confirmada!');
          this.sesionSeleccionada.set(null);
          await this.cargarDatos();
        } else {
          this.error.set(resultado.mensaje);
        }
      }
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error al procesar la reserva.');
    } finally {
      this.guardando.set(false);
    }
  }

  async onListaEspera() {
    const sesion = this.sesionSeleccionada();
    if (!sesion || this.esAdmin()) return;

    const userId = this.auth.userId();
    if (!userId) return;

    this.guardando.set(true);
    this.error.set(null);

    try {
      const { data, error } = await supabase().rpc('agregar_lista_espera', {
        p_usuario_id: userId,
        p_sesion_id: sesion.id,
      });

      if (error) {
        this.error.set(error.message);
        return;
      }

      if (data && data.length > 0) {
        const resultado = data[0];
        if (resultado.ok) {
          this.mensajeExito.set('Te has añadido a la lista de espera.');
          this.sesionSeleccionada.set(null);
        } else {
          this.error.set(resultado.mensaje);
        }
      }
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error al añadir a lista de espera.');
    } finally {
      this.guardando.set(false);
    }
  }

  getEstadoClase(sesion: Sesion): string {
    const seleccionada = this.sesionSeleccionada()?.id === sesion.id;
    if (seleccionada) return 'slot-btn--selected';
    if (sesion.estado === 'pasada') return 'slot-btn--pasada';
    if (sesion.estado === 'bloqueada') return 'slot-btn--bloqueada';
    if (sesion.estado === 'completa') return 'slot-btn--completa';
    return 'slot-btn--disponible';
  }

  getEstadoTexto(sesion: Sesion): string {
    if (sesion.estado === 'pasada') return 'Pasada';
    if (sesion.estado === 'bloqueada') return 'Cerrada';
    if (sesion.estado === 'completa') return 'Completa';
    return `${sesion.plazas_disponibles} plazas`;
  }

  getNombreModalidad(mod: Modalidad): string {
    return mod === 'focus' ? 'Focus' : 'Reducido';
  }

  obtenerNombreDia(dia: number): string {
    const dias = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    return dias[dia] || '';
  }

  formatearFecha(fecha: string): string {
    const d = new Date(fecha + 'T12:00:00');
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
  }

  volver() {
    this.router.navigateByUrl('/dashboard');
  }
}
