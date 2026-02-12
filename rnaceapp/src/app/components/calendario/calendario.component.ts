// src/app/components/calendario/calendario.component.ts
// ACTUALIZADO: Usa nuevas funciones del sistema de horarios fijos
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ConfirmationService } from '../../shared/confirmation-modal/confirmation.service';
import { supabase } from '../../core/supabase.client';
import { CustomSelectComponent, SelectOption } from '../../shared/ui/custom-select/custom-select.component';

interface DiaCalendario {
  fecha: string;
  dia: number;
  diaSemana: number;
  esDelMes: boolean;
  esHoy: boolean;
  esLaborable: boolean;
  esFestivo: boolean;
  mesAbierto: boolean;
  reservas: ReservaCalendario[];
}

interface ReservaCalendario {
  id: number;
  sesion_id: number;
  usuario_nombre: string;
  usuario_telefono: string;
  hora: string;
  modalidad: 'focus' | 'reducido';
  estado: string;
  es_propia: boolean;
}

interface MesAgenda {
  anio: number;
  mes: number;
  abierto: boolean;
}

interface ReservaDB {
  id: number;
  sesion_id: number;
  usuario_id: string;
  estado: string;
  sesiones:
  | {
    fecha: string;
    hora: string;
    modalidad: string;
  }
  | {
    fecha: string;
    hora: string;
    modalidad: string;
  }[]
  | null;
  usuario_nombre?: string;
  usuario_telefono?: string;
}

interface UsuarioDB {
  id: string;
  nombre: string;
  telefono: string;
}

interface ReservaDBLista {
  id: number;
  sesion_id: number;
  es_recuperacion: boolean;
  sesiones:
  | {
    fecha: string;
    hora: string;
    modalidad: string;
  }
  | {
    fecha: string;
    hora: string;
    modalidad: string;
  }[];
}

interface ReservaLista {
  id: number;
  sesion_id: number;
  fecha: string;
  hora: string;
  modalidad: 'focus' | 'reducido';
  dia_nombre: string;
  es_recuperacion: boolean;
  puede_cancelar: boolean;
}

interface ConflictoCierre {
  fecha: string;
  numReservas: number;
}

// Sesiones con disponibilidad para vista de cliente - Actualizado
interface SesionDia {
  id: number;
  hora: string;
  modalidad: 'focus' | 'reducido';
  capacidad: number;
  plazas_ocupadas: number;
  plazas_disponibles: number;
  tiene_reserva: boolean;     // El usuario ya tiene reserva aquí
  mi_reserva_id?: number;     // ID de la reserva si la tiene
  en_lista_espera: boolean;   // El usuario está en lista de espera
  fecha?: string;             // Fecha de la sesión (para modo cambio)
}

// Horario plantilla semanal
interface HorarioDisponible {
  id: number;
  dia_semana: number; // 1=Lun, 2=Mar, 3=Mié, 4=Jue, 5=Vie
  hora: string;
  modalidad: 'focus' | 'reducido';
  capacidad_maxima: number;
  activo: boolean;
}

// ...

@Component({
  standalone: true,
  selector: 'app-calendario',
  imports: [CommonModule, CustomSelectComponent],
  templateUrl: './calendario.component.html',
  styleUrls: ['./calendario.component.scss'],
})
export class CalendarioComponent implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private confirmation = inject(ConfirmationService);

  // Estado
  cargando = signal(true);
  guardando = signal(false);
  error = signal<string | null>(null);
  mensajeExito = signal<string | null>(null);

  // Fecha actual del calendario
  anioActual = signal(new Date().getFullYear());
  mesActual = signal(new Date().getMonth() + 1);

  // Datos
  diasCalendario = signal<DiaCalendario[]>([]);
  // reservasLista eliminada ya que usaremos el calendario para todos
  mesAgenda = signal<MesAgenda | null>(null);
  festivosSeleccionados = signal<Set<string>>(new Set());

  // Modal confirmación cierre
  mostrarModalConfirmacion = signal(false);
  conflictosCierre = signal<ConflictoCierre[]>([]);
  tipoCierreSeleccionado = signal<'festivo' | 'vacaciones' | null>(null);
  mesYaEstabAbierto = signal(false); // Track if month was already open when editing

  // Usuario
  esAdmin = computed(() => this.auth.getRol() === 'admin');
  userId = computed(() => this.auth.userId());

  // Modo edición
  modoEdicion = signal(false);

  // Modal detalle día
  diaSeleccionado = signal<DiaCalendario | null>(null);
  sesionesDiaSeleccionado = signal<SesionDia[]>([]); // Para vista cliente

  // Nuevo estado para el flujo de dos pasos en admin
  pasoModalDetalle = signal<'tipo' | 'lista'>('tipo');
  tipoGrupoSeleccionado = signal<'focus' | 'reducido' | null>(null);

  // Tipo de grupo del usuario actual (para restricciones de cambio)
  tipoGrupoUsuario = signal<'focus' | 'reducido' | 'hibrido' | null>(null);

  // === MODO CAMBIO DE CITA ===
  modoCambio = signal(false);
  reservaACambiar = signal<{ id: number; sesion_id: number; hora: string; fecha: string; modalidad: string } | null>(null);
  sesionesDisponiblesCambio = signal<SesionDia[]>([]);
  cargandoCambio = signal(false);
  festivosCambio = signal<Set<string>>(new Set()); // Festivos del mes para mostrar bloqueados

  // Mini-calendario para cambio: día seleccionado dentro del cambio
  diaCambioSeleccionado = signal<string | null>(null);

  // === CANCELACIÓN ADMIN ===
  mostrarModalCancelarAdmin = signal(false);
  reservaACancelarAdmin = signal<ReservaCalendario | null>(null);
  cancelandoAdmin = signal(false);

  // === AGREGAR USUARIO A SESIÓN (ADMIN) ===
  mostrarModalAgregarUsuario = signal(false);
  sesionesDelDiaAdmin = signal<{ id: number; hora: string; modalidad: string; capacidad: number; ocupadas: number }[]>([]);
  usuariosDisponiblesParaAgregar = signal<{ id: string; nombre: string; telefono: string }[]>([]);
  sesionSeleccionadaParaAgregar = signal<number | null>(null);
  usuarioSeleccionadoParaAgregar = signal<string | null>(null);
  agregandoUsuario = signal(false);
  cargandoUsuariosAgregar = signal(false);

  // === RECLAMAR PLAZA DE LISTA DE ESPERA ===
  mostrarModalReclamarPlaza = signal(false);
  sesionReclamar = signal<{ id: number; fecha: string; hora: string; modalidad: string } | null>(null);
  misReservasParaCambio = signal<{ id: number; sesion_id: number; fecha: string; hora: string; modalidad: string }[]>([]);
  recuperacionesDisponibles = signal<{ id: number; modalidad: string; mes_origen: number; anio_origen: number }[]>([]);
  reclamandoPlaza = signal(false);
  opcionReclamarSeleccionada = signal<'cambiar' | 'recuperacion' | null>(null);
  reservaSeleccionadaParaCambio = signal<number | null>(null);
  recuperacionSeleccionada = signal<number | null>(null);

  // === PANEL HORARIOS SEMANALES (ADMIN) ===
  panelHorariosExpandido = signal(false);
  horariosPlantilla = signal<HorarioDisponible[]>([]);
  cargandoHorarios = signal(false);
  guardandoHorario = signal(false);
  mostrarFormularioHorario = signal(false);
  horarioEditando = signal<HorarioDisponible | null>(null);
  formularioHorario = signal<{ dia_semana: number; hora: string; modalidad: 'focus' | 'reducido'; capacidad_maxima: number }>({
    dia_semana: 1,
    hora: '09:00',
    modalidad: 'focus',
    capacidad_maxima: 3
  });
  diasSemanaLabels = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
  diaSeleccionadoHorarios = signal<number | null>(null);

  // Opciones para custom selects
  opcionesDias: SelectOption[] = [
    { value: 1, label: 'Lunes' },
    { value: 2, label: 'Martes' },
    { value: 3, label: 'Miércoles' },
    { value: 4, label: 'Jueves' },
    { value: 5, label: 'Viernes' }
  ];

  opcionesHoras: SelectOption[] = Array.from({ length: 24 }, (_, i) => ({
    value: i.toString().padStart(2, '0'),
    label: i.toString().padStart(2, '0')
  }));

  opcionesMinutos: SelectOption[] = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'].map(m => ({
    value: m,
    label: m
  }));

  // Computed para extraer hora y minutos del formulario actual
  horaFormulario = computed(() => this.formularioHorario().hora.split(':')[0] || '09');
  minutosFormulario = computed(() => this.formularioHorario().hora.split(':')[1] || '00');

  // Computed: horarios agrupados por día
  horariosPorDia = computed(() => {
    const horarios = this.horariosPlantilla();
    const porDia: Map<number, HorarioDisponible[]> = new Map();

    // Inicializar días 1-5
    for (let i = 1; i <= 5; i++) {
      porDia.set(i, []);
    }

    // Agrupar horarios activos
    horarios.filter(h => h.activo).forEach(h => {
      const lista = porDia.get(h.dia_semana) || [];
      lista.push(h);
      porDia.set(h.dia_semana, lista);
    });

    // Ordenar por hora dentro de cada día
    porDia.forEach((lista, dia) => {
      porDia.set(dia, lista.sort((a, b) => a.hora.localeCompare(b.hora)));
    });

    return porDia;
  });

  // Computed: Mini-calendario de las reservas del usuario en el mismo mes
  semanasReclamarCalendario = computed(() => {
    const sesion = this.sesionReclamar();
    if (!sesion?.fecha) return [];

    const reservas = this.misReservasParaCambio();
    const reservasMap = new Map(reservas.map(r => [r.fecha, r]));

    const fechaSesion = new Date(sesion.fecha + 'T12:00:00');
    const anio = fechaSesion.getFullYear();
    const mes = fechaSesion.getMonth();

    const primerDiaMes = new Date(anio, mes, 1);
    const ultimoDiaMes = new Date(anio, mes + 1, 0).getDate();

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    type DiaCalendarioReclamar = {
      fecha: string;
      dia: number;
      tieneReserva: boolean;
      reservaId: number | null;
      hora: string | null;
      esPasado: boolean;
      esSesionTarget: boolean;
    } | null;

    const semanas: DiaCalendarioReclamar[][] = [];
    let semanaActual: DiaCalendarioReclamar[] = [];

    // Get the weekday of the first day (0=Sun, 1=Mon, ... 6=Sat)
    // We need to find the first WEEKDAY of the month and its position
    let primerDiaSemanaOriginal = primerDiaMes.getDay();
    // Convert to Monday=0, Tue=1, ... Fri=4, Sat=5, Sun=6
    let primerDiaSemana = primerDiaSemanaOriginal === 0 ? 6 : primerDiaSemanaOriginal - 1;

    // If first day is weekend (Sat=5 or Sun=6), start fresh (no placeholders for first week)
    // Only add initial placeholders if first weekday falls after Monday
    if (primerDiaSemana < 5) { // First day is a weekday
      for (let i = 0; i < primerDiaSemana; i++) {
        semanaActual.push(null);
      }
    }

    for (let dia = 1; dia <= ultimoDiaMes; dia++) {
      const fecha = `${anio}-${(mes + 1).toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;
      const fechaDate = new Date(anio, mes, dia);
      let diaSemanaOriginal = fechaDate.getDay();
      // Convert: Mon=0, Tue=1, Wed=2, Thu=3, Fri=4
      let diaSemana = diaSemanaOriginal === 0 ? 6 : diaSemanaOriginal - 1;

      // Only process weekdays (Mon-Fri = 0-4)
      if (diaSemana >= 0 && diaSemana <= 4) {
        const reserva = reservasMap.get(fecha);
        const esPasado = fechaDate < hoy;
        const esSesionTarget = sesion.fecha === fecha;

        semanaActual.push({
          fecha,
          dia,
          tieneReserva: !!reserva,
          reservaId: reserva?.id ?? null,
          hora: reserva?.hora ?? null,
          esPasado,
          esSesionTarget
        });

        // If it's Friday (4), close the week
        if (diaSemana === 4) {
          // Pad from the left if needed
          while (semanaActual.length < 5) {
            semanaActual.unshift(null);
          }
          semanas.push(semanaActual);
          semanaActual = [];
        }
      }
    }

    if (semanaActual.length > 0) {
      while (semanaActual.length < 5) {
        semanaActual.push(null);
      }
      semanas.push(semanaActual);
    }

    return semanas;
  });

  // Computed: Sesiones del día seleccionado en modo cambio
  sesionesCambioDia = computed(() => {
    const diaSelec = this.diaCambioSeleccionado();
    if (!diaSelec) return [];
    return this.sesionesDisponiblesCambio().filter(s => s.fecha === diaSelec);
  });

  // Computed: Días únicos con sesiones disponibles para cambio - estructurados por semanas
  diasConSesionesCambio = computed(() => {
    const sesiones = this.sesionesDisponiblesCambio();
    const festivos = this.festivosCambio();
    const diasMap = new Map<string, { fecha: string; tienePlazas: boolean; esMismodia: boolean; esFestivo: boolean }>();
    const reserva = this.reservaACambiar();

    // Primero añadir días con sesiones
    sesiones.forEach(s => {
      if (!s.fecha) return;
      const existing = diasMap.get(s.fecha);
      const tienePlazas = s.plazas_disponibles > 0 && !s.tiene_reserva;
      const esMismodia = reserva?.fecha === s.fecha;
      const esFestivo = festivos.has(s.fecha);

      if (!existing) {
        diasMap.set(s.fecha, { fecha: s.fecha, tienePlazas, esMismodia, esFestivo });
      } else if (tienePlazas && !existing.tienePlazas) {
        existing.tienePlazas = true;
      }
    });

    // Añadir festivos que no tienen sesiones (para mostrarlos bloqueados)
    festivos.forEach(fecha => {
      if (!diasMap.has(fecha)) {
        diasMap.set(fecha, { fecha, tienePlazas: false, esMismodia: false, esFestivo: true });
      }
    });

    return Array.from(diasMap.values()).sort((a, b) => a.fecha.localeCompare(b.fecha));
  });

  // Computed: Días agrupados por semanas para vista de calendario
  semanasCalendarioCambio = computed(() => {
    const reserva = this.reservaACambiar();
    if (!reserva?.fecha) return [];

    const fechaReserva = new Date(reserva.fecha + 'T12:00:00');
    const anio = fechaReserva.getFullYear();
    const mes = fechaReserva.getMonth();
    const festivos = this.festivosCambio();
    const diasConSesiones = this.diasConSesionesCambio();
    const sesionesMap = new Map(diasConSesiones.map(d => [d.fecha, d]));

    // Calcular el primer y último día del mes
    const primerDiaMes = new Date(anio, mes, 1);
    const ultimoDiaMes = new Date(anio, mes + 1, 0).getDate();

    // Para hoy (solo mostrar días desde hoy en adelante)
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const semanas: Array<Array<{ fecha: string; dia: number; diaSemana: number; tienePlazas: boolean; esMismodia: boolean; esFestivo: boolean; esPasado: boolean; esDelMes: boolean } | null>> = [];
    let semanaActual: Array<{ fecha: string; dia: number; diaSemana: number; tienePlazas: boolean; esMismodia: boolean; esFestivo: boolean; esPasado: boolean; esDelMes: boolean } | null> = [];

    // Get the weekday of the first day (0=Sun, 1=Mon, ... 6=Sat)
    // Convert to Monday=0, Tue=1, ... Fri=4, Sat=5, Sun=6
    let primerDiaSemanaOriginal = primerDiaMes.getDay();
    let primerDiaSemana = primerDiaSemanaOriginal === 0 ? 6 : primerDiaSemanaOriginal - 1;

    // If first day is weekend (Sat=5 or Sun=6), start fresh (no placeholders for first week)
    // Only add initial placeholders if first weekday falls after Monday
    if (primerDiaSemana < 5) { // First day is a weekday
      for (let i = 0; i < primerDiaSemana; i++) {
        semanaActual.push(null);
      }
    }

    // Añadir todos los días del mes
    for (let dia = 1; dia <= ultimoDiaMes; dia++) {
      const fecha = `${anio}-${(mes + 1).toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;
      const fechaDate = new Date(anio, mes, dia);
      let diaSemanaOriginal = fechaDate.getDay();
      // Convert: Mon=0, Tue=1, Wed=2, Thu=3, Fri=4
      let diaSemana = diaSemanaOriginal === 0 ? 6 : diaSemanaOriginal - 1;

      // Solo días laborables (Lun-Vie, es decir 0-4)
      if (diaSemana >= 0 && diaSemana <= 4) {
        const dataSesion = sesionesMap.get(fecha);
        const esPasado = fechaDate < hoy;
        const esFestivo = festivos.has(fecha);
        const esMismodia = reserva.fecha === fecha;

        semanaActual.push({
          fecha,
          dia,
          diaSemana,
          tienePlazas: dataSesion?.tienePlazas ?? false,
          esMismodia,
          esFestivo,
          esPasado,
          esDelMes: true
        });

        // Si es viernes (4), cerrar la semana
        if (diaSemana === 4) {
          // Pad from the left if needed
          while (semanaActual.length < 5) {
            semanaActual.unshift(null);
          }
          semanas.push(semanaActual);
          semanaActual = [];
        }
      }
    }

    // Añadir última semana si quedó incompleta
    if (semanaActual.length > 0) {
      while (semanaActual.length < 5) {
        semanaActual.push(null);
      }
      semanas.push(semanaActual);
    }

    return semanas;
  });

  // Sesiones filtradas: Solo muestra la sesión donde el cliente tiene su reserva
  sesionesFiltradasPorGrupo = computed(() => {
    const sesiones = this.sesionesDiaSeleccionado();

    // Si es admin, esta propiedad no debería usarse en la vista restringida
    if (this.esAdmin()) return sesiones;

    // Para clientes: mostrar SOLO la sesión donde tienen reserva
    const sesionesConReserva = sesiones.filter(s => s.tiene_reserva);
    console.log('Sesiones del cliente con reserva:', sesionesConReserva.length);

    return sesionesConReserva;
  });

  reservasDiaSeleccionadoOrdenadas = computed(() => {
    const dia = this.diaSeleccionado();
    const tipo = this.tipoGrupoSeleccionado();

    if (!dia) return [];

    let reservas = [...dia.reservas];

    // Si estamos en modo admin y hemos seleccionado un tipo, filtramos
    if (this.esAdmin() && tipo) {
      reservas = reservas.filter(r => r.modalidad === tipo);
    }

    return reservas.sort((a, b) => a.hora.localeCompare(b.hora));
  });

  reservasAgrupadasPorHora = computed(() => {
    const reservas = this.reservasDiaSeleccionadoOrdenadas();
    const grupos = new Map<string, ReservaCalendario[]>();

    reservas.forEach(r => {
      if (!grupos.has(r.hora)) {
        grupos.set(r.hora, []);
      }
      grupos.get(r.hora)!.push(r);
    });

    return Array.from(grupos.entries()).map(([hora, reservas]) => ({
      hora,
      reservas
    }));
  });

  // Computed
  nombreMes = computed(() => {
    const fecha = new Date(this.anioActual(), this.mesActual() - 1, 1);
    const nombreMes = fecha.toLocaleDateString('es-ES', { month: 'long' });
    const anio = this.anioActual();
    return `${nombreMes} ${anio}`;
  });

  mesEstaAbierto = computed(() => this.mesAgenda()?.abierto ?? false);

  // Solo mostrar lunes a viernes (diaSemana 0-4)
  diasCalendarioLaborables = computed(() => {
    return this.diasCalendario().filter((dia) => dia.diaSemana >= 0 && dia.diaSemana <= 4);
  });

  // Empezamos por Lunes (Lun, Mar, Mié, Jue, Vie)
  diasSemana = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie'];

  totalReservas = computed(() => {
    return this.diasCalendario().reduce((total, dia) => total + dia.reservas.length, 0);
  });

  reservasPorModalidad = computed(() => {
    let focus = 0;
    let reducido = 0;

    this.diasCalendario().forEach((dia) => {
      dia.reservas.forEach((r) => {
        if (r.modalidad === 'focus') focus++;
        else reducido++;
      });
    });

    return { focus, reducido };
  });

  // Variable para almacenar las reservas del usuario en el día actual
  misReservasDelDia = signal<{ id: number; sesion_id: number; hora: string }[]>([]);

  async onClickDia(dia: DiaCalendario) {
    if (this.modoEdicion()) {
      this.toggleFestivo(dia);
      return;
    }
    if (this.esAdmin()) {
      if (dia.reservas.length > 0) {
        this.pasoModalDetalle.set('tipo');
        this.tipoGrupoSeleccionado.set(null);
        this.diaSeleccionado.set(dia);
      }
      return;
    }
    if (dia.esDelMes && dia.esLaborable && !dia.esFestivo) {
      this.diaSeleccionado.set(dia);
      await this.cargarSesionesDia(dia.fecha);
    }
  }

  seleccionarTipoGrupo(tipo: 'focus' | 'reducido') {
    this.tipoGrupoSeleccionado.set(tipo);
    this.pasoModalDetalle.set('lista');
  }

  volverASeleccionTipo() {
    this.pasoModalDetalle.set('tipo');
    this.tipoGrupoSeleccionado.set(null);
  }

  // Método para verificar si el usuario puede cambiar a una sesión de cierta modalidad
  puedeCambiarA(modalidadSesion: 'focus' | 'reducido'): boolean {
    const tipo = this.tipoGrupoUsuario();
    // Los híbridos pueden cambiar a cualquier modalidad
    if (tipo === 'hibrido') return true;
    // Focus solo puede cambiar a Focus, Reducido solo a Reducido
    return tipo === modalidadSesion;
  }

  async cargarSesionesDia(fecha: string) {
    const uid = this.userId();
    if (!uid) return;
    this.cargando.set(true);
    try {
      // Asegurar que tenemos el tipo de grupo cargado
      if (!this.tipoGrupoUsuario()) {
        try {
          const { data: planData } = await supabase()
            .from('plan_usuario')
            .select('tipo_grupo')
            .eq('usuario_id', uid)
            .maybeSingle();
          if (planData?.tipo_grupo) {
            console.log('Cargando tipo grupo en dialogo:', planData.tipo_grupo);
            this.tipoGrupoUsuario.set(planData.tipo_grupo.toLowerCase() as 'focus' | 'reducido' | 'hibrido');
          }
        } catch (e) {
          console.error('Error cargando plan en dialogo:', e);
        }
      }

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
      const misReservas: { id: number; sesion_id: number; hora: string }[] = [];
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
    if (!await this.confirmation.confirm({
      titulo: 'Cambiar turno',
      mensaje: '¿Seguro que quieres cambiar tu clase a este nuevo horario?',
      tipo: 'info',
      textoConfirmar: 'Cambiar'
    })) return;
    this.guardando.set(true);

    try {
      const { data, error } = await supabase().rpc('cambiar_turno', { p_usuario_id: uid, p_reserva_id: reservaId, p_nueva_sesion_id: nuevaSesionId });
      if (error) throw error;

      if (data && data[0]?.ok) {
        // Cerrar el modal de cambio y el modal del día
        this.modoCambio.set(false);
        this.reservaACambiar.set(null);
        this.diaSeleccionado.set(null);

        // Recargar calendario primero
        await this.cargarCalendario();

        // Mostrar mensaje de éxito (después de recargar para que no sea borrado)
        this.mensajeExito.set(data[0].mensaje || '¡Clase cambiada correctamente!');

        // Auto-descartar después de 4 segundos
        setTimeout(() => this.mensajeExito.set(null), 4000);
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
        this.mensajeExito.set(data[0].mensaje || '✅ Te has apuntado a la lista de espera. Te avisaremos si hay hueco.');
        setTimeout(() => this.mensajeExito.set(null), 4000);
        const dia = this.diaSeleccionado();
        if (dia) await this.cargarSesionesDia(dia.fecha);
      } else { this.error.set(data?.[0]?.mensaje || 'Error al apuntarse a la lista de espera.'); }
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
        this.mensajeExito.set(data[0].mensaje || '✅ Te has quitado de la lista de espera.');
        setTimeout(() => this.mensajeExito.set(null), 4000);
        const dia = this.diaSeleccionado();
        if (dia) await this.cargarSesionesDia(dia.fecha);
      } else { this.error.set(data?.[0]?.mensaje || 'Error al salir de la lista de espera.'); }
    } catch (err: any) { this.error.set(err.message); } finally { this.guardando.set(false); }
  }

  ngOnInit() {
    this.cargarCalendario().then(async () => {
      // Cargar tipo de grupo del usuario (para restricciones de cambio)
      if (!this.esAdmin()) {
        const uid = this.userId();
        if (uid) {
          try {
            const { data } = await supabase()
              .from('plan_usuario')
              .select('tipo_grupo')
              .eq('usuario_id', uid)
              .maybeSingle();
            if (data?.tipo_grupo) {
              this.tipoGrupoUsuario.set(data.tipo_grupo.toLowerCase() as 'focus' | 'reducido' | 'hibrido');
            }
          } catch (err) {
            console.warn('Error cargando tipo de grupo:', err);
          }
        }
      }

      // Verificar si hay una sesión específica para abrir (desde notificación)
      this.route.queryParams.subscribe(async params => {
        const sesionId = params['sesion'];
        if (sesionId) {
          await this.abrirDiaDeSesion(Number(sesionId));
        }
      });
    });
  }

  async abrirDiaDeSesion(sesionId: number) {
    try {
      // Obtener detalles de la sesión
      const { data: sesion, error } = await supabase()
        .from('sesiones')
        .select('id, fecha, hora, modalidad')
        .eq('id', sesionId)
        .single();

      if (error || !sesion) return;

      const fechaSesion = sesion.fecha;
      const fechaDate = new Date(fechaSesion);

      // Si la sesión es de otro mes, cambiar mes
      const anioSesion = fechaDate.getFullYear();
      const mesSesion = fechaDate.getMonth() + 1;

      if (anioSesion !== this.anioActual() || mesSesion !== this.mesActual()) {
        this.anioActual.set(anioSesion);
        this.mesActual.set(mesSesion);
        await this.cargarCalendario();
      }

      // Si es cliente (no admin), abrir el modal de reclamar plaza
      if (!this.esAdmin()) {
        await this.abrirModalReclamarPlaza(sesion);
      } else {
        // Para admin, solo abrir el día
        const diaEncontrado = this.diasCalendario().find(d => d.fecha === fechaSesion);
        if (diaEncontrado) {
          await this.onClickDia(diaEncontrado);
        }
      }
    } catch (err) {
      console.warn('Error al intentar abrir sesión directa:', err);
    }
  }

  async abrirModalReclamarPlaza(sesion: { id: number; fecha: string; hora: string; modalidad: string }) {
    const uid = this.userId();
    if (!uid) return;

    this.sesionReclamar.set({
      id: sesion.id,
      fecha: sesion.fecha,
      hora: sesion.hora.slice(0, 5),
      modalidad: sesion.modalidad
    });
    this.mostrarModalReclamarPlaza.set(true);
    this.opcionReclamarSeleccionada.set(null);
    this.reservaSeleccionadaParaCambio.set(null);
    this.recuperacionSeleccionada.set(null);

    try {
      // Cargar reservas futuras del usuario para posible cambio
      const hoy = new Date().toISOString().split('T')[0];
      const { data: reservas } = await supabase()
        .from('reservas')
        .select('id, sesion_id, sesiones(fecha, hora, modalidad)')
        .eq('usuario_id', uid)
        .eq('estado', 'activa')
        .gte('sesiones.fecha', hoy);

      const reservasMapeadas = (reservas || [])
        .filter((r: any) => r.sesiones)
        .map((r: any) => {
          const s = Array.isArray(r.sesiones) ? r.sesiones[0] : r.sesiones;
          return {
            id: r.id,
            sesion_id: r.sesion_id,
            fecha: s.fecha,
            hora: s.hora.slice(0, 5),
            modalidad: s.modalidad
          };
        })
        // Filtrar solo reservas del mismo mes que la sesión objetivo
        .filter((r: any) => {
          const fechaSesion = new Date(sesion.fecha + 'T12:00:00');
          const fechaReserva = new Date(r.fecha + 'T12:00:00');
          return fechaSesion.getMonth() === fechaReserva.getMonth() &&
            fechaSesion.getFullYear() === fechaReserva.getFullYear();
        })
        .sort((a: any, b: any) => a.fecha.localeCompare(b.fecha));

      this.misReservasParaCambio.set(reservasMapeadas);

      // Cargar recuperaciones disponibles del usuario
      // Usamos el MES DE LA SESIÓN TARGET, no el mes actual
      const fechaSesionTarget = new Date(sesion.fecha + 'T12:00:00');
      const mesSesion = fechaSesionTarget.getMonth() + 1;
      const anioSesion = fechaSesionTarget.getFullYear();

      const { data: recuperaciones } = await supabase()
        .from('recuperaciones')
        .select('id, modalidad, mes_origen, anio_origen, mes_limite, anio_limite')
        .eq('usuario_id', uid)
        .eq('estado', 'disponible')
        .or(`modalidad.eq.${sesion.modalidad},modalidad.eq.hibrido`);

      // Filtrar recuperaciones válidas para el MES DE LA SESIÓN TARGET
      const recupValidas = (recuperaciones || []).filter((rec: any) => {
        // 1. No debe ser futura respecto al mes de la sesión
        if (anioSesion < rec.anio_origen) return false;
        if (anioSesion === rec.anio_origen && mesSesion < rec.mes_origen) return false;

        // 2. No debe estar caducada respecto al mes de la sesión
        if (anioSesion > rec.anio_limite) return false;
        if (anioSesion === rec.anio_limite && mesSesion > rec.mes_limite) return false;

        return true;
      });

      this.recuperacionesDisponibles.set(recupValidas);

    } catch (err) {
      console.error('Error cargando datos para reclamar plaza:', err);
    }
  }

  cerrarModalReclamarPlaza() {
    this.mostrarModalReclamarPlaza.set(false);
    this.sesionReclamar.set(null);
    this.misReservasParaCambio.set([]);
    this.recuperacionesDisponibles.set([]);
    this.opcionReclamarSeleccionada.set(null);
    this.reservaSeleccionadaParaCambio.set(null);
    this.recuperacionSeleccionada.set(null);
  }

  async confirmarReclamarPlaza() {
    const sesion = this.sesionReclamar();
    const opcion = this.opcionReclamarSeleccionada();
    const uid = this.userId();

    if (!sesion || !opcion || !uid) {
      this.error.set('Selecciona una opción');
      return;
    }

    this.reclamandoPlaza.set(true);
    this.error.set(null);

    try {
      if (opcion === 'cambiar') {
        const reservaId = this.reservaSeleccionadaParaCambio();
        if (!reservaId) {
          this.error.set('Selecciona una reserva para cambiar');
          return;
        }

        // Usar la función cambiar_turno existente
        const { data, error } = await supabase().rpc('cambiar_turno', {
          p_usuario_id: uid,
          p_reserva_id: reservaId,
          p_nueva_sesion_id: sesion.id
        });

        if (error) throw error;
        if (data && data[0]?.ok) {
          this.mensajeExito.set('¡Plaza reclamada! Tu reserva ha sido cambiada.');
          setTimeout(() => this.mensajeExito.set(null), 4000);
          this.cerrarModalReclamarPlaza();
          await this.cargarCalendario();
        } else {
          this.error.set(data?.[0]?.mensaje || 'Error al cambiar la reserva');
        }
      } else if (opcion === 'recuperacion') {
        const recuperacionId = this.recuperacionSeleccionada();
        if (!recuperacionId) {
          this.error.set('Selecciona una recuperación');
          return;
        }

        // Usar la función usar_recuperacion existente
        // Nota: La función auto-selecciona la recuperación más antigua válida
        const { data, error } = await supabase().rpc('usar_recuperacion', {
          p_usuario_id: uid,
          p_sesion_id: sesion.id
        });

        if (error) throw error;
        if (data && data[0]?.ok) {
          this.mensajeExito.set('¡Plaza reclamada con recuperación!');
          setTimeout(() => this.mensajeExito.set(null), 4000);
          this.cerrarModalReclamarPlaza();
          await this.cargarCalendario();
        } else {
          this.error.set(data?.[0]?.mensaje || 'Error al usar la recuperación');
        }
      }

      // Quitar de lista de espera ya que reclamó la plaza
      await supabase().rpc('quitar_lista_espera', {
        p_usuario_id: uid,
        p_sesion_id: sesion.id
      });

    } catch (err: any) {
      console.error('Error:', err);
      this.error.set(err.message || 'Error al reclamar la plaza');
    } finally {
      this.reclamandoPlaza.set(false);
    }
  }

  async cargarCalendario() {
    this.cargando.set(true);
    this.error.set(null);
    // NO resetear mensajeExito aquí - se gestiona con setTimeout y botón de cierre

    try {
      const anio = this.anioActual();
      const mes = this.mesActual();
      const client = supabase();

      // Cargar agenda del mes
      try {
        const { data: agendaData, error: agendaError } = await client
          .from('agenda_mes')
          .select('*')
          .eq('anio', anio)
          .eq('mes', mes)
          .maybeSingle();

        if (agendaError && agendaError.code !== 'PGRST116') {
          console.error('Error cargando agenda:', agendaError);
        }

        this.mesAgenda.set(agendaData || { anio, mes, abierto: false });
      } catch (err) {
        console.error('Error al cargar agenda del mes:', err);
        this.mesAgenda.set({ anio, mes, abierto: false });
      }

      // Calcular fechas del mes correctamente
      const primerDia = `${anio}-${mes.toString().padStart(2, '0')}-01`;
      // Último día del mes: creamos fecha del siguiente mes día 0
      const ultimoDiaMes = new Date(anio, mes, 0).getDate();
      const ultimoDia = `${anio}-${mes.toString().padStart(2, '0')}-${ultimoDiaMes.toString().padStart(2, '0')}`;

      // Cargar festivos
      const festivosSet = new Set<string>();
      try {
        const { data: festivosData, error: festivosError } = await client
          .from('festivos')
          .select('fecha')
          .gte('fecha', primerDia)
          .lte('fecha', ultimoDia);

        if (festivosError) {
          console.warn('Error cargando festivos:', festivosError);
        } else {
          (festivosData || []).forEach((f) => festivosSet.add(f.fecha));
        }
      } catch (err) {
        console.warn('Error al cargar festivos:', err);
      }

      let reservasData: ReservaDB[] = [];

      // Cargar reservas
      try {
        if (this.esAdmin()) {
          // ADMIN: cargar todas las reservas del mes
          const { data, error } = await client
            .from('reservas')
            .select(
              `
              id,
              sesion_id,
              usuario_id,
              estado,
              sesiones!inner (
                fecha,
                hora,
                modalidad
              )
            `,
            )
            .gte('sesiones.fecha', primerDia)
            .lte('sesiones.fecha', ultimoDia)
            .eq('estado', 'activa');

          if (error) {
            console.warn('Error cargando reservas:', error);
          } else {
            reservasData = (data as ReservaDB[]) || [];
          }

          // Cargar nombres de usuarios
          if (reservasData.length > 0) {
            try {
              const userIds = [...new Set(reservasData.map((r) => r.usuario_id))];
              const { data: usuariosData, error: usuariosError } = await client
                .from('usuarios')
                .select('id, nombre, telefono')
                .in('id', userIds);

              if (usuariosError) {
                console.warn('Error cargando usuarios:', usuariosError);
              } else {
                const usuariosMap = new Map<string, { nombre: string; telefono: string }>();
                ((usuariosData as UsuarioDB[]) || []).forEach((u) => {
                  usuariosMap.set(u.id, { nombre: u.nombre, telefono: u.telefono });
                });

                reservasData = reservasData.map((r) => ({
                  ...r,
                  usuario_nombre: usuariosMap.get(r.usuario_id)?.nombre || 'Sin nombre',
                  usuario_telefono: usuariosMap.get(r.usuario_id)?.telefono || '',
                }));
              }
            } catch (err) {
              console.warn('Error al cargar nombres de usuarios:', err);
            }
          }
        } else {
          // CLIENTE: solo sus propias reservas
          const uid = this.userId();
          if (uid) {
            const { data, error } = await client
              .from('reservas')
              .select(
                `
                id,
                sesion_id,
                usuario_id,
                estado,
                sesiones!inner (
                  fecha,
                  hora,
                  modalidad
                )
              `,
              )
              .eq('usuario_id', uid)
              .gte('sesiones.fecha', primerDia)
              .lte('sesiones.fecha', ultimoDia)
              .eq('estado', 'activa');

            if (error) {
              console.warn('Error cargando reservas del usuario:', error);
            } else {
              reservasData = ((data as ReservaDB[]) || []).map((r) => ({
                ...r,
                usuario_nombre: this.auth.usuario()?.nombre || 'Tú',
                usuario_telefono: this.auth.usuario()?.telefono || '',
              }));
            }

            // Cargar tipo de grupo del usuario
            try {
              const { data: planData } = await client
                .from('planes')
                .select('tipo_grupo')
                .eq('usuario_id', uid)
                .maybeSingle();
              if (planData?.tipo_grupo) {
                this.tipoGrupoUsuario.set(planData.tipo_grupo as 'focus' | 'reducido' | 'hibrido');
              }
            } catch (err) {
              console.warn('Error cargando tipo de grupo:', err);
            }
          }
        }
      } catch (err) {
        console.warn('Error al cargar reservas:', err);
      }

      const dias = this.construirDiasCalendario(anio, mes, festivosSet, reservasData);
      this.diasCalendario.set(dias);
    } catch (err) {
      console.error('Error general cargando calendario:', err);
      this.error.set('Error al cargar el calendario.');
    } finally {
      this.cargando.set(false);
    }
  }

  private construirDiasCalendario(
    anio: number,
    mes: number,
    festivos: Set<string>,
    reservasData: ReservaDB[],
  ): DiaCalendario[] {
    const dias: DiaCalendario[] = [];

    // Obtener información del mes usando Date con parámetros numéricos (evita problemas de zona horaria)
    const primerDiaDelMes = new Date(anio, mes - 1, 1);
    const ultimoDiaMes = new Date(anio, mes, 0).getDate(); // Último día del mes

    // getDay() devuelve 0=Dom, 1=Lun, etc. Convertimos a 0=Lun, 1=Mar, etc.
    let primerDiaSemana = primerDiaDelMes.getDay();
    // Convertir: Dom(0)->6, Lun(1)->0, Mar(2)->1, etc.
    primerDiaSemana = primerDiaSemana === 0 ? 6 : primerDiaSemana - 1;

    // Fecha de hoy para comparar
    const hoyDate = new Date();
    const hoy = `${hoyDate.getFullYear()}-${(hoyDate.getMonth() + 1).toString().padStart(2, '0')}-${hoyDate.getDate().toString().padStart(2, '0')}`;

    const mesAbierto = this.mesAgenda()?.abierto ?? false;
    const userId = this.userId();

    // Mapa de reservas por fecha
    const reservasPorFecha = new Map<string, ReservaCalendario[]>();
    reservasData.forEach((r) => {
      if (!r.sesiones) return;

      // Supabase puede devolver un objeto o un array dependiendo de la relación
      const sesion = Array.isArray(r.sesiones) ? r.sesiones[0] : r.sesiones;
      if (!sesion) return;

      const fecha = sesion.fecha;
      const hora = sesion.hora.substring(0, 5);

      const reserva: ReservaCalendario = {
        id: r.id,
        sesion_id: r.sesion_id,
        usuario_nombre: r.usuario_nombre || 'Desconocido',
        usuario_telefono: r.usuario_telefono || '',
        hora: hora,
        modalidad: sesion.modalidad as 'focus' | 'reducido',
        estado: r.estado,
        es_propia: r.usuario_id === userId,
      };

      if (!reservasPorFecha.has(fecha)) {
        reservasPorFecha.set(fecha, []);
      }
      reservasPorFecha.get(fecha)!.push(reserva);
    });

    // Días del mes anterior para completar primera semana
    if (primerDiaSemana > 0) {
      const mesAnterior = mes === 1 ? 12 : mes - 1;
      const anioAnterior = mes === 1 ? anio - 1 : anio;
      const ultimoDiaMesAnterior = new Date(anio, mes - 1, 0).getDate();

      for (let i = primerDiaSemana - 1; i >= 0; i--) {
        const dia = ultimoDiaMesAnterior - i;
        const fecha = `${anioAnterior}-${mesAnterior.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;

        // Calcular día de la semana usando Date con parámetros numéricos
        const fechaObj = new Date(anioAnterior, mesAnterior - 1, dia);
        let diaSemana = fechaObj.getDay();
        diaSemana = diaSemana === 0 ? 6 : diaSemana - 1; // Convertir a formato Lun=0

        dias.push({
          fecha,
          dia,
          diaSemana,
          esDelMes: false,
          esHoy: false,
          esLaborable: false,
          esFestivo: false,
          mesAbierto: false,
          reservas: [],
        });
      }
    }

    // Días del mes actual
    for (let dia = 1; dia <= ultimoDiaMes; dia++) {
      const fecha = `${anio}-${mes.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;

      // Usar Date con parámetros numéricos para evitar problemas de zona horaria
      const fechaObj = new Date(anio, mes - 1, dia);
      let diaSemana = fechaObj.getDay();
      // Convertir: Dom(0)->6, Lun(1)->0, Mar(2)->1, etc.
      diaSemana = diaSemana === 0 ? 6 : diaSemana - 1;

      // Laborable: Lun(0) a Vie(4)
      const esLaborable = diaSemana >= 0 && diaSemana <= 4;
      const esFestivo = festivos.has(fecha);

      dias.push({
        fecha,
        dia,
        diaSemana,
        esDelMes: true,
        esHoy: fecha === hoy,
        esLaborable,
        esFestivo: mesAbierto ? esFestivo : false,
        mesAbierto,
        reservas: mesAbierto ? (reservasPorFecha.get(fecha) || []) : [],
      });
    }

    // Días del mes siguiente para completar última semana
    const totalDias = dias.length;
    const diasFaltantes = totalDias % 7 === 0 ? 0 : 7 - (totalDias % 7);

    if (diasFaltantes > 0) {
      const mesSiguiente = mes === 12 ? 1 : mes + 1;
      const anioSiguiente = mes === 12 ? anio + 1 : anio;

      for (let dia = 1; dia <= diasFaltantes; dia++) {
        const fecha = `${anioSiguiente}-${mesSiguiente.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;

        const fechaObj = new Date(anioSiguiente, mesSiguiente - 1, dia);
        let diaSemana = fechaObj.getDay();
        diaSemana = diaSemana === 0 ? 6 : diaSemana - 1;

        dias.push({
          fecha,
          dia,
          diaSemana,
          esDelMes: false,
          esHoy: false,
          esLaborable: false,
          esFestivo: false,
          mesAbierto: false,
          reservas: [],
        });
      }
    }

    return dias;
  }

  mesAnterior() {
    if (this.mesActual() === 1) {
      this.mesActual.set(12);
      this.anioActual.update((a) => a - 1);
    } else {
      this.mesActual.update((m) => m - 1);
    }
    this.modoEdicion.set(false);
    this.festivosSeleccionados.set(new Set());
    this.cargarCalendario();
  }

  mesSiguiente() {
    if (this.mesActual() === 12) {
      this.mesActual.set(1);
      this.anioActual.update((a) => a + 1);
    } else {
      this.mesActual.update((m) => m + 1);
    }
    this.modoEdicion.set(false);
    this.festivosSeleccionados.set(new Set());
    this.cargarCalendario();
  }

  activarModoEdicion() {
    if (!this.esAdmin()) return;

    const festivosActuales = new Set<string>();
    this.diasCalendario().forEach((dia) => {
      if (dia.esFestivo && dia.esDelMes) {
        festivosActuales.add(dia.fecha);
      }
    });

    // Track if month was already open when entering edit mode
    this.mesYaEstabAbierto.set(this.mesEstaAbierto());
    this.festivosSeleccionados.set(festivosActuales);
    this.modoEdicion.set(true);
    this.error.set(null);
    this.mensajeExito.set(null);
  }

  cancelarEdicion() {
    this.modoEdicion.set(false);
    this.festivosSeleccionados.set(new Set());
    this.error.set(null);
  }

  toggleFestivo(dia: DiaCalendario) {
    if (!this.modoEdicion() || !dia.esDelMes || !dia.esLaborable) return;

    const festivos = new Set(this.festivosSeleccionados());

    if (festivos.has(dia.fecha)) {
      festivos.delete(dia.fecha);
    } else {
      festivos.add(dia.fecha);
    }

    this.festivosSeleccionados.set(festivos);
  }

  esFestivoSeleccionado(fecha: string): boolean {
    return this.festivosSeleccionados().has(fecha);
  }

  guardarYAbrirMes() {
    if (!this.esAdmin()) return;

    const festivos = this.festivosSeleccionados();
    const conflictos: ConflictoCierre[] = [];

    this.diasCalendario().forEach((dia) => {
      if (festivos.has(dia.fecha) && dia.reservas.length > 0) {
        conflictos.push({
          fecha: dia.fecha,
          numReservas: dia.reservas.length,
        });
      }
    });

    if (conflictos.length > 0) {
      this.conflictosCierre.set(conflictos);
      this.mostrarModalConfirmacion.set(true);
    } else {
      this.procesarGuardado();
    }
  }

  cancelarCierre() {
    this.mostrarModalConfirmacion.set(false);
    this.conflictosCierre.set([]);
    this.tipoCierreSeleccionado.set(null);
  }

  confirmarCierreConConflictos(tipoCierre: 'festivo' | 'vacaciones') {
    this.tipoCierreSeleccionado.set(tipoCierre);
    this.mostrarModalConfirmacion.set(false);
    // Only generate recoveries if closure type is 'festivo'
    const generarRecuperaciones = tipoCierre === 'festivo';
    this.procesarGuardado(generarRecuperaciones);
  }

  async procesarGuardado(generarRecuperaciones: boolean = true) {
    if (!this.esAdmin()) return;

    this.guardando.set(true);
    this.error.set(null);
    this.mensajeExito.set(null);

    try {
      const anio = this.anioActual();
      const mes = this.mesActual();
      const client = supabase();

      const primerDia = `${anio}-${mes.toString().padStart(2, '0')}-01`;
      const ultimoDiaMes = new Date(anio, mes, 0).getDate();
      const ultimoDia = `${anio}-${mes.toString().padStart(2, '0')}-${ultimoDiaMes.toString().padStart(2, '0')}`;

      const { error: deleteError } = await client
        .from('festivos')
        .delete()
        .gte('fecha', primerDia)
        .lte('fecha', ultimoDia);

      if (deleteError) {
        console.error('Error eliminando festivos:', deleteError);
        this.error.set(`Error al limpiar festivos: ${deleteError.message}`);
        return;
      }

      const festivosArray = [...this.festivosSeleccionados()];
      let recuperacionesGeneradas = 0;

      if (festivosArray.length > 0) {
        const festivosInsert = festivosArray.map((fecha) => ({
          fecha,
          descripcion: 'Día festivo/cerrado',
        }));

        const { error: insertError } = await client.from('festivos').insert(festivosInsert);

        if (insertError) {
          console.error('Error insertando festivos:', insertError);
          this.error.set(`Error al guardar festivos: ${insertError.message}`);
          return;
        }

        // Cancelar reservas existentes en los días festivos
        // Only generate recuperaciones if generarRecuperaciones is true (FESTIVO type)

        // OPTIMIZACIÓN: Recoger todos los IDs de reserva afectadas primero
        const reservaIds: number[] = [];
        for (const fecha of festivosArray) {
          const dia = this.diasCalendario().find(d => d.fecha === fecha);
          if (dia && dia.reservas.length > 0) {
            for (const reserva of dia.reservas) {
              reservaIds.push(reserva.id);
            }
          }
        }

        if (reservaIds.length > 0) {
          // OPTIMIZACIÓN: Una sola query para obtener todos los datos necesarios
          const { data: reservasCompletas } = await client
            .from('reservas')
            .select('id, usuario_id, sesion_id, sesiones(modalidad, fecha)')
            .in('id', reservaIds);

          if (reservasCompletas && reservasCompletas.length > 0) {
            // OPTIMIZACIÓN: Cancelar todas las reservas en una sola operación batch
            await client
              .from('reservas')
              .update({
                estado: 'cancelada',
                cancelada_en: new Date().toISOString(),
                cancelada_correctamente: true
              })
              .in('id', reservaIds);

            // Preparar datos para inserciones batch
            const recuperacionesAInsertar: any[] = [];
            const notificacionesAInsertar: any[] = [];
            const usuariosNotificados = new Set<string>(); // Evitar duplicados por usuario

            for (const reserva of reservasCompletas) {
              const sesionData = Array.isArray(reserva.sesiones)
                ? reserva.sesiones[0]
                : reserva.sesiones;

              if (!sesionData) continue;

              const fechaSesion = new Date(sesionData.fecha);
              const mesOrigen = fechaSesion.getMonth() + 1;
              const anioOrigen = fechaSesion.getFullYear();

              // Calcular mes límite (mes siguiente)
              let mesLimite = mesOrigen + 1;
              let anioLimite = anioOrigen;
              if (mesLimite > 12) {
                mesLimite = 1;
                anioLimite++;
              }

              // Preparar recuperación si corresponde
              if (generarRecuperaciones) {
                recuperacionesAInsertar.push({
                  usuario_id: reserva.usuario_id,
                  sesion_cancelada_id: reserva.sesion_id,
                  modalidad: sesionData.modalidad,
                  mes_origen: mesOrigen,
                  anio_origen: anioOrigen,
                  mes_limite: mesLimite,
                  anio_limite: anioLimite,
                  estado: 'disponible'
                });
              }

              // Preparar notificación (solo una por usuario)
              if (!usuariosNotificados.has(reserva.usuario_id)) {
                usuariosNotificados.add(reserva.usuario_id);
                const fechaFormateada = fechaSesion.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
                const mensajeNotif = generarRecuperaciones
                  ? `Tu clase del ${fechaFormateada} ha sido cancelada por festivo. Se ha generado una recuperación.`
                  : `Tu clase del ${fechaFormateada} ha sido cancelada por vacaciones.`;

                notificacionesAInsertar.push({
                  usuario_id: reserva.usuario_id,
                  tipo: 'cancelacion',
                  titulo: generarRecuperaciones ? 'Clase cancelada por festivo' : 'Clase cancelada por vacaciones',
                  mensaje: mensajeNotif,
                  leida: false
                });
              }
            }

            // OPTIMIZACIÓN: Insertar recuperaciones y notificaciones en batch con Promise.all
            const batchOperations: Promise<any>[] = [];

            if (recuperacionesAInsertar.length > 0) {
              batchOperations.push(
                Promise.resolve(client.from('recuperaciones').insert(recuperacionesAInsertar)).then(({ error }) => {
                  if (error) {
                    console.warn('Error insertando recuperaciones:', error);
                  } else {
                    recuperacionesGeneradas = recuperacionesAInsertar.length;
                    console.log(`${recuperacionesGeneradas} recuperaciones generadas`);
                  }
                })
              );
            }

            if (notificacionesAInsertar.length > 0) {
              batchOperations.push(
                Promise.resolve(client.from('notificaciones').insert(notificacionesAInsertar)).then(async ({ error }) => {
                  if (error) {
                    console.warn('Error insertando notificaciones:', error);
                  } else {
                    console.log(`${notificacionesAInsertar.length} notificaciones enviadas`);

                    // Enviar push notifications reales a cada usuario afectado
                    const pushPromises = notificacionesAInsertar.map(notif =>
                      supabase().functions.invoke('send-push', {
                        body: {
                          user_id: notif.usuario_id,
                          tipo: 'cancelacion',
                          data: { titulo: notif.titulo, mensaje: notif.mensaje }
                        }
                      }).catch(err => console.warn('[Push] Error enviando push cancelacion:', err))
                    );
                    await Promise.allSettled(pushPromises);
                  }
                })
              );
            }

            // Ejecutar operaciones en paralelo
            await Promise.all(batchOperations);
          }
        }

        if (recuperacionesGeneradas > 0) {
          console.log(`Total recuperaciones generadas: ${recuperacionesGeneradas}`);
        }
      }

      const { data: existente } = await client
        .from('agenda_mes')
        .select('anio, mes')
        .eq('anio', anio)
        .eq('mes', mes)
        .maybeSingle();

      if (existente) {
        const { error: updateError } = await client
          .from('agenda_mes')
          .update({ abierto: true })
          .eq('anio', anio)
          .eq('mes', mes);

        if (updateError) {
          console.error('Error actualizando agenda_mes:', updateError);
          this.error.set(`Error al abrir el mes: ${updateError.message}`);
          return;
        }
      } else {
        const { error: insertError } = await client
          .from('agenda_mes')
          .insert({ anio, mes, abierto: true });

        if (insertError) {
          console.error('Error insertando agenda_mes:', insertError);
          this.error.set(`Error al abrir el mes: ${insertError.message}`);
          return;
        }
      }

      // Generar sesiones del mes
      const { error: genError } = await client.rpc('generar_sesiones_mes', {
        p_anio: anio,
        p_mes: mes,
      });

      if (genError) {
        console.warn('No se pudieron generar sesiones automáticamente:', genError);
      }

      // Generar reservas automáticas desde horarios fijos de todos los usuarios
      const { data: regenData, error: regenError } = await client.rpc('regenerar_reservas_futuras');

      if (regenError) {
        console.warn('No se pudieron generar reservas automáticamente:', regenError);
      } else if (regenData) {
        console.log('Reservas regeneradas:', regenData);
      }
      // Mensaje de éxito según lo que se hizo
      const numFestivos = festivosArray.length;
      if (numFestivos > 0) {
        let mensaje = `Configuración guardada: ${numFestivos} día${numFestivos > 1 ? 's' : ''} marcado${numFestivos > 1 ? 's' : ''} como festivo.`;
        if (recuperacionesGeneradas > 0) {
          mensaje += ` Se generaron ${recuperacionesGeneradas} recuperación${recuperacionesGeneradas > 1 ? 'es' : ''}.`;
        }
        this.mensajeExito.set(mensaje);
      } else {
        this.mensajeExito.set('Mes abierto correctamente. Los usuarios ya pueden reservar.');
      }
      this.modoEdicion.set(false);
      this.festivosSeleccionados.set(new Set());

      await this.cargarCalendario();
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error inesperado al guardar.');
    } finally {
      this.guardando.set(false);
    }
  }

  async cerrarMes() {
    if (!this.esAdmin()) return;

    if (
      !await this.confirmation.confirm({
        titulo: 'Cerrar mes',
        mensaje: '¿Estás seguro de cerrar este mes? Los usuarios no podrán hacer nuevas reservas.',
        tipo: 'warning',
        textoConfirmar: 'Cerrar Mes'
      })
    ) {
      return;
    }

    this.guardando.set(true);
    this.error.set(null);

    try {
      const anio = this.anioActual();
      const mes = this.mesActual();
      const client = supabase();

      const { data: existente } = await client
        .from('agenda_mes')
        .select('anio, mes')
        .eq('anio', anio)
        .eq('mes', mes)
        .maybeSingle();

      if (existente) {
        const { error } = await client
          .from('agenda_mes')
          .update({ abierto: false })
          .eq('anio', anio)
          .eq('mes', mes);

        if (error) {
          this.error.set(`Error al cerrar el mes: ${error.message}`);
          return;
        }
      } else {
        const { error } = await client.from('agenda_mes').insert({ anio, mes, abierto: false });

        if (error) {
          this.error.set(`Error al cerrar el mes: ${error.message}`);
          return;
        }
      }

      this.mensajeExito.set('Mes cerrado. Los usuarios no pueden hacer nuevas reservas.');
      await this.cargarCalendario();
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error inesperado.');
    } finally {
      this.guardando.set(false);
    }
  }

  getDiaClases(dia: DiaCalendario): string {
    const clases = ['dia-celda'];

    if (!dia.esDelMes) clases.push('dia-celda--otro-mes');
    if (dia.esHoy) clases.push('dia-celda--hoy');

    // Fin de semana (Sáb=5, Dom=6) o festivo = bloqueado
    if (!dia.esLaborable && dia.esDelMes) clases.push('dia-celda--bloqueado');

    if (dia.esDelMes && dia.esLaborable) {
      if (this.modoEdicion()) {
        if (this.esFestivoSeleccionado(dia.fecha)) {
          clases.push('dia-celda--festivo-seleccionado');
        }
      } else {
        if (dia.esFestivo) clases.push('dia-celda--festivo');
      }
    }

    // Solo mostrar indicador de reservas si no es día festivo
    if (dia.reservas.length > 0 && !this.modoEdicion() && !dia.esFestivo) {
      clases.push('dia-celda--con-reservas');
    }

    return clases.join(' ');
  }



  cerrarDetalleDia() {
    this.diaSeleccionado.set(null);
    this.sesionesDiaSeleccionado.set([]);
    // NO resetear mensajeExito aquí - debe permanecer visible después de cerrar el modal
    this.error.set(null);
    // Reset modo cambio
    this.modoCambio.set(false);
    this.reservaACambiar.set(null);
    this.sesionesDisponiblesCambio.set([]);
  }

  getReservasCount(dia: DiaCalendario, tipo: 'focus' | 'reducido'): number {
    return dia.reservas.filter((r) => r.modalidad === tipo).length;
  }

  // === FUNCIONES MODO CAMBIO DE CITA ===

  /**
   * Inicia el modo cambio: guarda la reserva a cambiar y carga sesiones disponibles
   */
  async iniciarCambio(reserva: { id: number; sesion_id: number; hora: string }, fecha: string, modalidad: string) {
    this.reservaACambiar.set({ ...reserva, fecha, modalidad });
    this.modoCambio.set(true);
    await this.cargarSesionesParaCambio(modalidad);
  }

  /**
   * Cancela el modo cambio y vuelve a la vista normal del día
   */
  cancelarModoCambio() {
    this.modoCambio.set(false);
    this.reservaACambiar.set(null);
    this.sesionesDisponiblesCambio.set([]);
    this.diaCambioSeleccionado.set(null);
  }

  /**
   * Selecciona un día en el mini-calendario del modo cambio
   */
  seleccionarDiaCambio(fecha: string) {
    this.diaCambioSeleccionado.set(fecha);
  }

  /**
   * Vuelve al mini-calendario de selección de día
   */
  volverAMiniCalendario() {
    this.diaCambioSeleccionado.set(null);
  }

  /**
   * Helper para obtener nombre del día de la semana
   */
  getNombreDia(fecha: string): string {
    const date = new Date(fecha + 'T12:00:00');
    return date.toLocaleDateString('es-ES', { weekday: 'short' });
  }

  /**
   * Helper para obtener número del día
   */
  getNumeroDia(fecha: string): number {
    return new Date(fecha + 'T12:00:00').getDate();
  }

  /**
   * Carga todas las sesiones futuras de la modalidad del usuario para el cambio.
   * Solo muestra sesiones del mismo mes que la clase a cambiar.
   */
  async cargarSesionesParaCambio(modalidad: string) {
    const uid = this.userId();
    if (!uid) return;

    this.cargandoCambio.set(true);

    try {
      const ahora = new Date();
      const hoyStr = ahora.toISOString().split('T')[0];

      // Usar el mes de la reserva que se está cambiando (no el mes visualizado)
      const reserva = this.reservaACambiar();
      if (!reserva?.fecha) {
        this.error.set('No se pudo determinar la fecha de la reserva.');
        return;
      }

      const fechaReserva = new Date(reserva.fecha + 'T12:00:00');
      const anio = fechaReserva.getFullYear();
      const mes = fechaReserva.getMonth() + 1;

      // Obtener todas las sesiones del mismo mes que la reserva a cambiar
      const primerDia = `${anio}-${mes.toString().padStart(2, '0')}-01`;
      const ultimoDiaMes = new Date(anio, mes, 0).getDate();
      const ultimoDia = `${anio}-${mes.toString().padStart(2, '0')}-${ultimoDiaMes.toString().padStart(2, '0')}`;

      // Usar el mayor entre hoy y el primer día del mes para el límite inferior
      // Esto asegura que solo se muestren sesiones futuras Y del mismo mes
      const fechaMinima = hoyStr > primerDia ? hoyStr : primerDia;

      // Cargar festivos del mes para mostrarlos bloqueados en el calendario
      const festivosSet = new Set<string>();
      try {
        const { data: festivosData, error: festivosError } = await supabase()
          .from('festivos')
          .select('fecha')
          .gte('fecha', primerDia)
          .lte('fecha', ultimoDia);

        if (!festivosError && festivosData) {
          festivosData.forEach(f => festivosSet.add(f.fecha));
        }
      } catch (err) {
        console.warn('Error cargando festivos para cambio:', err);
      }
      // Guardar festivos para usarlos en la vista del calendario
      this.festivosCambio.set(festivosSet);

      const { data: sesiones, error } = await supabase()
        .from('sesiones')
        .select('*')
        .eq('modalidad', modalidad)
        .eq('cancelada', false)
        .gte('fecha', fechaMinima)
        .lte('fecha', ultimoDia)
        .order('fecha')
        .order('hora');

      if (error) throw error;
      if (!sesiones || sesiones.length === 0) {
        this.sesionesDisponiblesCambio.set([]);
        return;
      }

      // Filtrar sesiones que ya han comenzado (pero NO excluir festivos - se mostrarán bloqueados)
      const ahoras = ahora.getTime();
      const sesionesFuturas = sesiones.filter(s => {
        // Excluir sesiones en días festivos del listado de sesiones disponibles
        // (los festivos se muestran en el calendario pero bloqueados, sin sesiones)
        if (festivosSet.has(s.fecha)) return false;

        const fechaHoraSesion = new Date(`${s.fecha}T${s.hora}`).getTime();
        return fechaHoraSesion > ahoras;
      });

      // Obtener reservas activas del usuario en estas sesiones
      const { data: reservas } = await supabase()
        .from('reservas')
        .select('sesion_id')
        .eq('usuario_id', uid)
        .eq('estado', 'activa')
        .in('sesion_id', sesionesFuturas.map(s => s.id));

      const tieneReservaSet = new Set(reservas?.map(r => r.sesion_id) || []);

      // Obtener lista de espera
      const { data: espera } = await supabase()
        .from('lista_espera')
        .select('sesion_id')
        .eq('usuario_id', uid)
        .in('sesion_id', sesionesFuturas.map(s => s.id));

      const esperaSet = new Set(espera?.map(e => e.sesion_id) || []);

      // Obtener disponibilidad
      const { data: disponibilidad } = await supabase()
        .from('vista_sesiones_disponibilidad')
        .select('sesion_id, plazas_ocupadas, plazas_disponibles')
        .in('sesion_id', sesionesFuturas.map(s => s.id));

      const dispMap = new Map(disponibilidad?.map(d => [d.sesion_id, d]) || []);

      // Construir lista de sesiones
      const sesionesParaCambio: SesionDia[] = sesionesFuturas.map(s => {
        const disp = dispMap.get(s.id);
        return {
          id: s.id,
          hora: s.hora.slice(0, 5),
          modalidad: s.modalidad,
          capacidad: s.capacidad,
          plazas_ocupadas: disp?.plazas_ocupadas || 0,
          plazas_disponibles: disp?.plazas_disponibles || s.capacidad,
          tiene_reserva: tieneReservaSet.has(s.id),
          en_lista_espera: esperaSet.has(s.id),
          // Campo extra para mostrar fecha en el cambio
          fecha: s.fecha
        };
      });

      this.sesionesDisponiblesCambio.set(sesionesParaCambio);

    } catch (err) {
      console.error('Error cargando sesiones para cambio:', err);
      this.error.set('Error al cargar sesiones disponibles.');
    } finally {
      this.cargandoCambio.set(false);
    }
  }

  /**
   * Confirma el cambio de turno llamando a la función SQL
   */
  async confirmarCambioTurno(nuevaSesionId: number) {
    const uid = this.userId();
    const reserva = this.reservaACambiar();
    if (!uid || !reserva) return;

    if (!await this.confirmation.confirm({
      titulo: 'Confirmar cambio de clase',
      mensaje: '¿Estás seguro de cambiar tu clase a este nuevo horario?',
      tipo: 'info',
      textoConfirmar: 'Sí, cambiar'
    })) {
      return;
    }

    this.guardando.set(true);
    this.error.set(null);

    try {
      const { data, error } = await supabase().rpc('cambiar_turno', {
        p_usuario_id: uid,
        p_reserva_id: reserva.id,
        p_nueva_sesion_id: nuevaSesionId
      });

      if (error) throw error;

      if (data && data[0]?.ok) {
        // Primero cerrar todo
        this.cerrarDetalleDia();
        // Recargar calendario
        await this.cargarCalendario();
        // Mostrar mensaje de éxito (después de todo para que no sea borrado)
        this.mensajeExito.set(data[0].mensaje || '¡Clase cambiada correctamente!');
        setTimeout(() => this.mensajeExito.set(null), 4000);
      } else {
        this.error.set(data?.[0]?.mensaje || 'No se pudo realizar el cambio.');
      }

    } catch (err: any) {
      console.error('Error cambiando turno:', err);
      this.error.set(err.message || 'Error al cambiar el turno.');
    } finally {
      this.guardando.set(false);
    }
  }



  /**
   * Formatea una fecha para mostrar
   */
  formatearFechaCambio(fecha: string): string {
    const d = new Date(fecha + 'T12:00:00');
    const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };
    const formatted = d.toLocaleDateString('es-ES', options);
    // Capitalize first letter
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  }

  async cancelarReserva(reservaId: number) {
    if (!await this.confirmation.confirm({
      titulo: 'Cancelar reserva',
      mensaje: '¿Estás seguro de cancelar esta reserva?',
      tipo: 'danger',
      textoConfirmar: 'Sí, cancelar',
      textoCancelar: 'No'
    })) {
      return;
    }

    this.guardando.set(true);
    this.error.set(null);
    this.mensajeExito.set(null);

    try {
      const uid = this.userId();
      if (!uid) return;

      const { data, error } = await supabase().rpc('cancelar_reserva', {
        p_usuario_id: uid,
        p_reserva_id: reservaId,
      });

      if (error) {
        this.error.set('Error al cancelar la reserva: ' + error.message);
        return;
      }

      if (data && data.length > 0) {
        const resultado = data[0];
        if (resultado.ok) {
          this.mensajeExito.set(resultado.mensaje);
        } else {
          this.error.set(resultado.mensaje);
        }
      }
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error al cancelar la reserva.');
    } finally {
      this.guardando.set(false);
    }
  }

  // Verifica si una reserva puede ser cancelada (al menos 1 hora antes)
  puedeCancelar(reserva: ReservaCalendario): boolean {
    const dia = this.diaSeleccionado();
    if (!dia) return false;

    const fechaHoraReserva = new Date(`${dia.fecha}T${reserva.hora}:00`);
    const ahora = new Date();
    const diferenciaMs = fechaHoraReserva.getTime() - ahora.getTime();
    const unaHoraMs = 60 * 60 * 1000;

    return diferenciaMs >= unaHoraMs;
  }

  // Cancelar reserva desde el modal y recargar datos
  async cancelarReservaDesdeModal(reservaId: number) {
    if (!await this.confirmation.confirm({
      titulo: 'Cancelar clase',
      mensaje: '¿Estás seguro de cancelar esta clase? Se generará una recuperación si corresponde.',
      tipo: 'danger',
      textoConfirmar: 'Cancelar clase'
    })) {
      return;
    }

    this.guardando.set(true);
    this.error.set(null);

    try {
      // VALIDACIÓN LOCAL: Verificar si falta menos de 1 hora
      const sesion = this.sesionesDiaSeleccionado().find(s => s.mi_reserva_id === reservaId);
      const dia = this.diaSeleccionado();

      if (sesion && dia) {
        const fechaHoraReserva = new Date(`${dia.fecha}T${sesion.hora}:00`);
        const ahora = new Date();
        const diferenciaMs = fechaHoraReserva.getTime() - ahora.getTime();
        const unaHoraMs = 60 * 60 * 1000;

        if (diferenciaMs < unaHoraMs) {
          this.error.set('No se puede cancelar con menos de 1 hora de antelación.');
          return;
        }
      }

      this.guardando.set(true);
      this.error.set(null);

      const uid = this.userId();
      if (!uid) return;

      const { data, error } = await supabase().rpc('cancelar_reserva', {
        p_usuario_id: uid,
        p_reserva_id: reservaId,
      });

      if (error) {
        this.error.set('Error al cancelar la clase: ' + error.message);
        return;
      }

      if (data && data.length > 0) {
        const resultado = data[0];
        if (resultado.ok) {
          // ÉXITO: Mostrar Modal de Feedback en lugar de mensaje plano
          await this.confirmation.confirm({
            titulo: 'Clase cancelada',
            mensaje: resultado.mensaje || 'Reserva cancelada correctamente. Se ha generado una recuperación.',
            tipo: 'info',
            textoConfirmar: 'Entendido',
            textoCancelar: '' // Esto oculta el botón de cancelar
          });

          this.diaSeleccionado.set(null);
          await this.cargarCalendario();
        } else {
          this.error.set(resultado.mensaje);
        }
      }
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error al cancelar la clase.');
    } finally {
      this.guardando.set(false);
    }
  }

  // === CANCELACIÓN ADMIN ===
  abrirModalCancelarAdmin(reserva: ReservaCalendario) {
    this.reservaACancelarAdmin.set(reserva);
    this.mostrarModalCancelarAdmin.set(true);
  }

  cerrarModalCancelarAdmin() {
    this.mostrarModalCancelarAdmin.set(false);
    this.reservaACancelarAdmin.set(null);
  }

  async cancelarReservaAdmin(generarRecuperacion: boolean) {
    const reserva = this.reservaACancelarAdmin();
    if (!reserva) return;

    this.cancelandoAdmin.set(true);
    this.error.set(null);

    try {
      const { data, error } = await supabase().rpc('cancelar_reserva_admin', {
        p_reserva_id: reserva.id,
        p_generar_recuperacion: generarRecuperacion
      });

      if (error) {
        console.error('Error RPC:', error);
        this.error.set('Error al cancelar la reserva: ' + error.message);
        return;
      }

      if (data && data.length > 0 && data[0].ok) {
        this.mensajeExito.set(data[0].mensaje);
        setTimeout(() => this.mensajeExito.set(null), 3000);
        this.cerrarModalCancelarAdmin();

        // Enviar push notification al usuario afectado
        try {
          const { data: reservaData } = await supabase()
            .from('reservas')
            .select('usuario_id')
            .eq('id', reserva.id)
            .single();

          if (reservaData?.usuario_id) {
            await supabase().functions.invoke('send-push', {
              body: {
                user_id: reservaData.usuario_id,
                tipo: 'reserva_cancelada',
                data: { mensaje: data[0].mensaje }
              }
            });
          }
        } catch (pushErr) {
          console.warn('[Push] Error enviando push cancelación admin:', pushErr);
        }

        // Recargar calendario para reflejar los cambios
        await this.cargarCalendario();
        // Cerrar el modal del día también
        this.diaSeleccionado.set(null);
      } else {
        this.error.set(data?.[0]?.mensaje || 'Error al cancelar la reserva');
      }
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error inesperado al cancelar la reserva');
    } finally {
      this.cancelandoAdmin.set(false);
    }
  }

  // === AGREGAR USUARIO A SESIÓN (ADMIN) ===
  async abrirModalAgregarUsuario() {
    const dia = this.diaSeleccionado();
    const tipoGrupo = this.tipoGrupoSeleccionado();
    if (!dia || !tipoGrupo) return;

    this.error.set(null);
    this.cargandoUsuariosAgregar.set(true);
    this.mostrarModalAgregarUsuario.set(true);
    this.sesionSeleccionadaParaAgregar.set(null);
    this.usuarioSeleccionadoParaAgregar.set(null);

    try {
      // 1. Cargar sesiones del día para el tipo de grupo seleccionado
      const { data: sesiones, error: sesError } = await supabase()
        .from('sesiones')
        .select('id, hora, modalidad, capacidad')
        .eq('fecha', dia.fecha)
        .eq('modalidad', tipoGrupo)
        .eq('cancelada', false)
        .order('hora');

      if (sesError) throw sesError;

      // 2. Obtener ocupación de cada sesión
      const sesionIds = sesiones?.map(s => s.id) || [];
      let ocupacionMap = new Map<number, number>();

      if (sesionIds.length > 0) {
        const { data: reservas } = await supabase()
          .from('reservas')
          .select('sesion_id')
          .in('sesion_id', sesionIds)
          .eq('estado', 'activa');

        if (reservas) {
          for (const r of reservas) {
            ocupacionMap.set(r.sesion_id, (ocupacionMap.get(r.sesion_id) || 0) + 1);
          }
        }
      }

      this.sesionesDelDiaAdmin.set((sesiones || []).map(s => ({
        id: s.id,
        hora: s.hora.slice(0, 5),
        modalidad: s.modalidad,
        capacidad: s.capacidad,
        ocupadas: ocupacionMap.get(s.id) || 0
      })));

      // 3. Cargar usuarios del grupo correspondiente
      await this.cargarUsuariosParaAgregar(tipoGrupo);
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error al cargar datos para agregar usuario');
    } finally {
      this.cargandoUsuariosAgregar.set(false);
    }
  }

  async cargarUsuariosParaAgregar(modalidad: 'focus' | 'reducido') {
    try {
      // Buscar usuarios cuyo plan es del tipo correspondiente o híbrido
      const { data: planes, error: planError } = await supabase()
        .from('plan_usuario')
        .select('usuario_id, tipo_grupo')
        .eq('activo', true)
        .or(`tipo_grupo.eq.${modalidad},tipo_grupo.eq.hibrido`);

      if (planError) throw planError;
      if (!planes || planes.length === 0) {
        this.usuariosDisponiblesParaAgregar.set([]);
        return;
      }

      const userIds = planes.map(p => p.usuario_id);

      // Obtener info de usuarios
      const { data: usuarios, error: usrError } = await supabase()
        .from('usuarios')
        .select('id, nombre, telefono')
        .in('id', userIds)
        .eq('activo', true)
        .order('nombre');

      if (usrError) throw usrError;

      this.usuariosDisponiblesParaAgregar.set(usuarios || []);
    } catch (err) {
      console.error('Error cargando usuarios:', err);
      this.usuariosDisponiblesParaAgregar.set([]);
    }
  }

  cerrarModalAgregarUsuario() {
    this.mostrarModalAgregarUsuario.set(false);
    this.sesionSeleccionadaParaAgregar.set(null);
    this.usuarioSeleccionadoParaAgregar.set(null);
    this.usuariosDisponiblesParaAgregar.set([]);
    this.sesionesDelDiaAdmin.set([]);
  }

  // Usuarios filtrados para la sesión seleccionada (excluye los que ya tienen reserva)
  usuariosFiltradosParaSesion = computed(() => {
    const sesionId = this.sesionSeleccionadaParaAgregar();
    const usuarios = this.usuariosDisponiblesParaAgregar();
    const dia = this.diaSeleccionado();

    if (!sesionId || !dia) return usuarios;

    // Obtener usuarios que ya tienen reserva en esta sesión
    const usuariosEnSesion = new Set(
      dia.reservas
        .filter(r => r.sesion_id === sesionId)
        .map(r => {
          // Necesitamos el usuario_id pero solo tenemos nombre
          // Vamos a excluir por nombre como aproximación
          return r.usuario_nombre;
        })
    );

    return usuarios.filter(u => !usuariosEnSesion.has(u.nombre));
  });

  async agregarUsuarioASesion() {
    const sesionId = this.sesionSeleccionadaParaAgregar();
    const usuarioId = this.usuarioSeleccionadoParaAgregar();

    if (!sesionId || !usuarioId) {
      this.error.set('Selecciona una sesión y un usuario');
      return;
    }

    this.agregandoUsuario.set(true);
    this.error.set(null);

    try {
      // Verificar que no exista ya una reserva activa
      const { data: existente } = await supabase()
        .from('reservas')
        .select('id')
        .eq('sesion_id', sesionId)
        .eq('usuario_id', usuarioId)
        .eq('estado', 'activa')
        .maybeSingle();

      if (existente) {
        this.error.set('Este usuario ya tiene una reserva en esta sesión');
        return;
      }

      // Crear la reserva
      const { error: insertError } = await supabase()
        .from('reservas')
        .insert({
          sesion_id: sesionId,
          usuario_id: usuarioId,
          estado: 'activa',
          es_recuperacion: false,
          es_desde_horario_fijo: false
        });

      if (insertError) throw insertError;

      this.mensajeExito.set('Usuario añadido correctamente a la sesión');
      setTimeout(() => this.mensajeExito.set(null), 3000);
      this.cerrarModalAgregarUsuario();

      // Recargar calendario para reflejar cambios
      await this.cargarCalendario();
      this.diaSeleccionado.set(null);
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error al añadir usuario a la sesión');
    } finally {
      this.agregandoUsuario.set(false);
    }
  }

  volver() {
    this.router.navigateByUrl('/dashboard');
  }

  // === MÉTODOS PANEL HORARIOS SEMANALES ===

  togglePanelHorarios() {
    const nuevoEstado = !this.panelHorariosExpandido();
    this.panelHorariosExpandido.set(nuevoEstado);

    // Cargar horarios si se expande y no están cargados
    if (nuevoEstado && this.horariosPlantilla().length === 0) {
      this.cargarHorarios();
    }
  }

  async cargarHorarios() {
    this.cargandoHorarios.set(true);
    try {
      const { data, error } = await supabase()
        .from('horarios_disponibles')
        .select('*')
        .order('dia_semana')
        .order('hora');

      if (error) throw error;

      this.horariosPlantilla.set((data || []).map(h => ({
        id: h.id,
        dia_semana: h.dia_semana,
        hora: h.hora.slice(0, 5), // Formato HH:MM
        modalidad: h.modalidad as 'focus' | 'reducido',
        capacidad_maxima: h.capacidad_maxima,
        activo: h.activo
      })));
    } catch (err) {
      console.error('Error cargando horarios:', err);
      this.error.set('Error al cargar los horarios');
    } finally {
      this.cargandoHorarios.set(false);
    }
  }

  abrirFormularioHorario(diaSemana: number) {
    this.horarioEditando.set(null);
    this.formularioHorario.set({
      dia_semana: diaSemana,
      hora: '09:00',
      modalidad: 'focus',
      capacidad_maxima: 3
    });
    this.mostrarFormularioHorario.set(true);
  }

  editarHorario(horario: HorarioDisponible) {
    this.horarioEditando.set(horario);
    this.formularioHorario.set({
      dia_semana: horario.dia_semana,
      hora: horario.hora,
      modalidad: horario.modalidad,
      capacidad_maxima: horario.capacidad_maxima
    });
    this.mostrarFormularioHorario.set(true);
  }

  cerrarFormularioHorario() {
    this.mostrarFormularioHorario.set(false);
    this.horarioEditando.set(null);
  }

  actualizarCampoHorario(campo: 'dia_semana' | 'hora' | 'modalidad' | 'capacidad_maxima', valor: any) {
    this.formularioHorario.update(f => ({ ...f, [campo]: valor }));
  }

  actualizarHora(nuevaHora: string) {
    const minutos = this.minutosFormulario();
    this.actualizarCampoHorario('hora', `${nuevaHora}:${minutos}`);
  }

  actualizarMinutos(nuevosMinutos: string) {
    const hora = this.horaFormulario();
    this.actualizarCampoHorario('hora', `${hora}:${nuevosMinutos}`);
  }

  async guardarHorario() {
    const form = this.formularioHorario();
    const editando = this.horarioEditando();

    this.guardandoHorario.set(true);
    this.error.set(null);

    try {
      if (editando) {
        // Update
        const { error } = await supabase()
          .from('horarios_disponibles')
          .update({
            dia_semana: form.dia_semana,
            hora: form.hora,
            modalidad: form.modalidad,
            capacidad_maxima: form.capacidad_maxima
          })
          .eq('id', editando.id);

        if (error) throw error;

        // Si se actualiza, también deberíamos intentar sincronizar (crear nuevas si cambió hora/día)
        // Por simplicidad, tratamos como nuevo para "rellenar huecos"
        await this.sincronizarHorarioConSesiones({ ...editando, ...form, activo: true });

      } else {
        // Antes de insertar, comprobar si ya existe (aunque esté inactivo) para evitar error de constraint unique
        const { data: existente } = await supabase()
          .from('horarios_disponibles')
          .select('id')
          .eq('dia_semana', form.dia_semana)
          .eq('hora', form.hora)
          .eq('modalidad', form.modalidad)
          .maybeSingle();

        if (existente) {
          // Si existe, lo reactivamos y actualizamos
          const { error: updateError } = await supabase()
            .from('horarios_disponibles')
            .update({
              capacidad_maxima: form.capacidad_maxima,
              activo: true
            })
            .eq('id', existente.id);

          if (updateError) throw updateError;

          // Sincronizar con ID existente
          await this.sincronizarHorarioConSesiones({ ...form, id: existente.id, activo: true });

        } else {
          // Insert normal si no existe
          const { data, error } = await supabase()
            .from('horarios_disponibles')
            .insert({
              dia_semana: form.dia_semana,
              hora: form.hora,
              modalidad: form.modalidad,
              capacidad_maxima: form.capacidad_maxima,
              activo: true
            })
            .select()
            .single();

          if (error) throw error;

          if (data) {
            await this.sincronizarHorarioConSesiones(data);
          }
        }
      }

      await this.cargarHorarios();
      this.cerrarFormularioHorario();

      // Finalmente, regenerar reservas futuras para todos los usuarios
      // Esto asegura que si el cambio de horario afecta a usuarios existentes, se actualicen sus reservas
      try {
        await supabase().rpc('regenerar_reservas_futuras');
      } catch (rpcError) {
        console.error('Error regenerando reservas:', rpcError);
        // No bloqueamos el éxito, pero logueamos
      }

      this.mensajeExito.set('Horario guardado correctamente. Las sesiones y reservas futuras se han actualizado.');
      setTimeout(() => this.mensajeExito.set(null), 3000);

    } catch (e: any) {
      console.error('Error guardando horario:', e);
      this.error.set('Error al guardar horario: ' + e.message);
    } finally {
      this.guardandoHorario.set(false);
    }
  }

  // Sincroniza un horario plantilla con las sesiones reales de los meses abiertos
  private async sincronizarHorarioConSesiones(horario: HorarioDisponible) {
    if (!horario.activo) return;

    try {
      // 1. Obtener meses abiertos (agenda_mes)
      const { data: mesesAbiertos, error: errorMeses } = await supabase()
        .from('agenda_mes')
        .select('*')
        .eq('abierto', true);

      if (errorMeses || !mesesAbiertos || mesesAbiertos.length === 0) {
        console.log('No hay meses abiertos para sincronizar');
        return;
      }

      const sesionesAInsertar: any[] = [];
      const fechaActual = new Date();
      fechaActual.setHours(0, 0, 0, 0);

      // 2. Para cada mes abierto, buscar los días correspondientes
      for (const mesAgenda of mesesAbiertos) {
        const anio = mesAgenda.anio;
        const mes = mesAgenda.mes; // 1-12

        const primerDia = new Date(anio, mes - 1, 1);
        const ultimoDia = new Date(anio, mes, 0);

        // Iterar días del mes
        for (let d = new Date(primerDia); d <= ultimoDia; d.setDate(d.getDate() + 1)) {
          // d.getDay(): 0=Dom, 1=Lun, 2=Mar, 3=Mié, 4=Jue, 5=Vie, 6=Sáb
          // horario.dia_semana en BD: 1=Lun, 2=Mar, 3=Mié, 4=Jue, 5=Vie
          // Para convertir getDay() a formato BD: si getDay()=0 (Dom)->7, sino getDay()
          let diaSemanaISO = d.getDay();
          if (diaSemanaISO === 0) diaSemanaISO = 7; // Domingo = 7

          if (diaSemanaISO === horario.dia_semana) {
            // Solo fechas futuras o de hoy
            if (d < fechaActual) continue;

            const fechaStr = this.formatearFechaISO(d);

            // Campos correctos de la tabla sesiones: fecha, hora, modalidad, capacidad, cancelada
            sesionesAInsertar.push({
              fecha: fechaStr,
              hora: horario.hora,
              modalidad: horario.modalidad,
              capacidad: horario.capacidad_maxima,
              cancelada: false
            });
          }
        }
      }

      if (sesionesAInsertar.length === 0) {
        console.log('No hay sesiones nuevas para crear');
        return;
      }

      // 3. Buscar sesiones existentes para evitar duplicados
      const fechas = sesionesAInsertar.map(s => s.fecha);
      const hora = horario.hora;

      const { data: existentes } = await supabase()
        .from('sesiones')
        .select('fecha, hora, modalidad')
        .in('fecha', fechas)
        .eq('hora', hora)
        .eq('modalidad', horario.modalidad);

      const existentesSet = new Set(existentes?.map(s => `${s.fecha}_${s.hora}_${s.modalidad}`));

      const paraInsertar = sesionesAInsertar.filter(s =>
        !existentesSet.has(`${s.fecha}_${s.hora}_${s.modalidad}`)
      );

      if (paraInsertar.length > 0) {
        const { error: insertError } = await supabase()
          .from('sesiones')
          .insert(paraInsertar);

        if (insertError) {
          console.error('Error sincronizando sesiones:', insertError);
        } else {
          console.log(`Sincronizadas ${paraInsertar.length} nuevas sesiones para el horario día ${horario.dia_semana} ${horario.hora}`);
        }
      } else {
        console.log('Todas las sesiones ya existían');
      }

    } catch (err) {
      console.error('Error en sincronización de sesiones:', err);
    }
  }

  private formatearFechaISO(date: Date): string {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  async eliminarHorario(horario: HorarioDisponible) {
    if (!await this.confirmation.confirm({
      titulo: 'Eliminar horario',
      mensaje: `¿Eliminar el turno de las ${horario.hora} (${horario.modalidad}) del ${this.diasSemanaLabels[horario.dia_semana - 1]}? Se cancelarán todas las sesiones futuras y reservas asociadas sin generar recuperaciones.`,
      tipo: 'warning',
      textoConfirmar: 'Eliminar'
    })) {
      return;
    }

    this.guardandoHorario.set(true);

    try {
      const client = supabase();
      const hoy = new Date().toISOString().split('T')[0];

      // 1. Buscar sesiones futuras que coincidan con este horario (día de semana, hora, modalidad)
      const { data: sesionesFuturas, error: sesionesError } = await client
        .from('sesiones')
        .select('id')
        .eq('hora', horario.hora)
        .eq('modalidad', horario.modalidad)
        .eq('cancelada', false)
        .gte('fecha', hoy);

      if (sesionesError) {
        console.error('Error buscando sesiones:', sesionesError);
      }

      // Filtrar solo las sesiones que corresponden al mismo día de la semana
      const sesionesDelDia = (sesionesFuturas || []).filter(s => {
        // Necesitamos obtener la fecha de cada sesión para verificar el día de la semana
        // Como solo tenemos el id, haremos una segunda consulta o usamos los datos del calendario
        return true; // Por ahora incluimos todas y filtramos abajo
      });

      if (sesionesFuturas && sesionesFuturas.length > 0) {
        // Obtener datos completos de las sesiones para filtrar por día de semana
        const { data: sesionesCompletas } = await client
          .from('sesiones')
          .select('id, fecha')
          .in('id', sesionesFuturas.map(s => s.id));

        const sesionesAEliminar = (sesionesCompletas || []).filter(s => {
          const fecha = new Date(s.fecha + 'T12:00:00');
          let diaSemana = fecha.getDay();
          // Convertir: Dom(0)->7, Lun(1)->1, etc. para comparar con horario.dia_semana (1-5)
          diaSemana = diaSemana === 0 ? 7 : diaSemana;
          return diaSemana === horario.dia_semana;
        });

        if (sesionesAEliminar.length > 0) {
          const sesionIds = sesionesAEliminar.map(s => s.id);

          // 2. Cancelar todas las reservas de esas sesiones SIN generar recuperaciones
          const { error: reservasError } = await client
            .from('reservas')
            .update({
              estado: 'cancelada',
              cancelada_en: new Date().toISOString(),
              cancelada_correctamente: true
            })
            .in('sesion_id', sesionIds)
            .eq('estado', 'activa');

          if (reservasError) {
            console.warn('Error cancelando reservas:', reservasError);
          }

          // 3. Marcar las sesiones como canceladas
          const { error: cancelarSesionesError } = await client
            .from('sesiones')
            .update({ cancelada: true })
            .in('id', sesionIds);

          if (cancelarSesionesError) {
            console.warn('Error cancelando sesiones:', cancelarSesionesError);
          }

          // 4. Eliminar de lista de espera de esas sesiones
          const { error: esperaError } = await client
            .from('lista_espera')
            .delete()
            .in('sesion_id', sesionIds);

          if (esperaError) {
            console.warn('Error eliminando lista de espera:', esperaError);
          }
        }
      }

      // 5. Desactivar el horario (soft delete)
      const { error } = await client
        .from('horarios_disponibles')
        .update({ activo: false })
        .eq('id', horario.id);

      if (error) throw error;

      this.mensajeExito.set('Horario eliminado correctamente');
      setTimeout(() => this.mensajeExito.set(null), 3000);
      await this.cargarHorarios();
      await this.cargarCalendario(); // Recargar calendario para reflejar cambios
    } catch (err) {
      console.error('Error eliminando horario:', err);
      this.error.set('Error al eliminar el horario');
    } finally {
      this.guardandoHorario.set(false);
    }
  }

  getCapacidadDefault(modalidad: 'focus' | 'reducido'): number {
    return modalidad === 'focus' ? 3 : 8;
  }
}
