// src/app/components/calendario/calendario.component.ts
// ACTUALIZADO: Usa nuevas funciones del sistema de horarios fijos
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ConfirmationService } from '../../shared/confirmation-modal/confirmation.service';
import { supabase } from '../../core/supabase.client';

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

// ...

@Component({
  standalone: true,
  selector: 'app-calendario',
  imports: [CommonModule],
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

    // Determinar el día de la semana del primer día (0=Dom -> 6=Sab, convertir a 0=Lun)
    let primerDiaSemana = primerDiaMes.getDay();
    primerDiaSemana = primerDiaSemana === 0 ? 6 : primerDiaSemana - 1;

    // Rellenar días vacíos antes del primer día
    for (let i = 0; i < primerDiaSemana; i++) {
      semanaActual.push(null);
    }

    // Añadir todos los días del mes
    for (let dia = 1; dia <= ultimoDiaMes; dia++) {
      const fecha = `${anio}-${(mes + 1).toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;
      const fechaDate = new Date(anio, mes, dia);
      let diaSemana = fechaDate.getDay();
      diaSemana = diaSemana === 0 ? 6 : diaSemana - 1;

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
          // Asegurarse de que la semana tenga 5 elementos (Lun-Vie)
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
      // Obtener fecha de la sesión
      const { data, error } = await supabase()
        .from('sesiones')
        .select('fecha')
        .eq('id', sesionId)
        .single();

      if (error || !data) return;

      const fechaSesion = data.fecha;
      const fechaDate = new Date(fechaSesion);

      // Si la sesión es de otro mes, cambiar mes
      const anioSesion = fechaDate.getFullYear();
      const mesSesion = fechaDate.getMonth() + 1;

      // Asumimos que podemos cambiar el mes directamente
      if (anioSesion !== this.anioActual() || mesSesion !== this.mesActual()) {
        this.anioActual.set(anioSesion);
        this.mesActual.set(mesSesion);
        await this.cargarCalendario();
      }

      // Encontrar día en el calendario actual
      // (Esperamos un poco a que se actualice el signal de diasCalendario si cambiamos de mes)
      // Aunque como cargarCalendario es await, debería estar listo
      const diaEncontrado = this.diasCalendario().find(d => d.fecha === fechaSesion);

      if (diaEncontrado) {
        // Abrir el detalle directamente
        await this.onClickDia(diaEncontrado);
      }

    } catch (err) {
      console.warn('Error al intentar abrir sesión directa:', err);
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
        esFestivo,
        mesAbierto,
        reservas: reservasPorFecha.get(fecha) || [],
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
  }

  confirmarCierreConConflictos() {
    this.mostrarModalConfirmacion.set(false);
    this.procesarGuardado();
  }

  async procesarGuardado() {
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

        // Cancelar reservas existentes en los días festivos y generar recuperaciones
        const reservasAfectadas: { reservaId: number; usuarioId: string }[] = [];

        // Buscar reservas en los días marcados como festivos
        for (const fecha of festivosArray) {
          const dia = this.diasCalendario().find(d => d.fecha === fecha);
          if (dia && dia.reservas.length > 0) {
            for (const reserva of dia.reservas) {
              // Obtener usuario_id de la reserva
              const { data: reservaData } = await client
                .from('reservas')
                .select('usuario_id')
                .eq('id', reserva.id)
                .single();

              if (reservaData) {
                reservasAfectadas.push({
                  reservaId: reserva.id,
                  usuarioId: reservaData.usuario_id
                });
              }
            }
          }
        }

        // Cancelar reservas y generar recuperaciones DIRECTAMENTE (sin RPC)
        for (const { reservaId, usuarioId } of reservasAfectadas) {
          try {
            // 1. Obtener datos de la sesión para la recuperación
            const { data: reservaCompleta } = await client
              .from('reservas')
              .select('sesion_id, sesiones(modalidad, fecha)')
              .eq('id', reservaId)
              .single();

            if (!reservaCompleta) continue;

            const sesionData = Array.isArray(reservaCompleta.sesiones)
              ? reservaCompleta.sesiones[0]
              : reservaCompleta.sesiones;

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

            // 2. Cancelar la reserva
            await client
              .from('reservas')
              .update({
                estado: 'cancelada',
                cancelada_en: new Date().toISOString(),
                cancelada_correctamente: true
              })
              .eq('id', reservaId);

            // 3. Insertar recuperación en la tabla principal
            const { error: recupError } = await client
              .from('recuperaciones')
              .insert({
                usuario_id: usuarioId,
                sesion_cancelada_id: reservaCompleta.sesion_id,
                modalidad: sesionData.modalidad,
                mes_origen: mesOrigen,
                anio_origen: anioOrigen,
                mes_limite: mesLimite,
                anio_limite: anioLimite,
                estado: 'disponible'
              });

            if (!recupError) {
              recuperacionesGeneradas++;
              console.log(`Reserva ${reservaId} cancelada, recuperación generada para usuario ${usuarioId}`);

              // 4. Insertar notificación al usuario
              const fechaFormateada = fechaSesion.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
              await client
                .from('notificaciones')
                .insert({
                  usuario_id: usuarioId,
                  tipo: 'cancelacion',
                  titulo: 'Clase cancelada por festivo',
                  mensaje: `Tu clase del ${fechaFormateada} ha sido cancelada por festivo. Se ha generado una recuperación.`,
                  leida: false
                });
            } else {
              console.warn('Error insertando recuperación:', recupError);
            }

          } catch (err) {
            console.warn(`Error cancelando reserva ${reservaId}:`, err);
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

    if (dia.reservas.length > 0 && !this.modoEdicion()) {
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
    return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
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
        this.cerrarModalCancelarAdmin();
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

  volver() {
    this.router.navigateByUrl('/dashboard');
  }
}
