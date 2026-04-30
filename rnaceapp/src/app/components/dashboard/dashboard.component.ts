// src/app/components/dashboard/dashboard.component.ts
import { CommonModule } from '@angular/common';
import { Component, inject, computed, signal, OnInit, OnDestroy } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { supabase } from '../../core/supabase.client';
import { NotificationPromptComponent } from '../../shared/notification-prompt/notificacion-prompt.component';

interface ProximaClase {
  id: number;
  sesion_id: number;
  fecha: string;
  fecha_raw: string; // Para calcular días hasta
  hora: string;
  hora_raw: string; // Para filtrar clases terminadas
  modalidad: 'focus' | 'reducido';
  dia_nombre: string;
  es_recuperacion: boolean;
  es_desde_horario_fijo: boolean;
  capacidad: number;
  reservas_count: number;
}

interface HorarioFijoDashboard {
  horarios_disponibles:
  | {
    dia_semana: number;
    hora: string;
    modalidad: 'focus' | 'reducido';
    activo: boolean;
  }
  | {
    dia_semana: number;
    hora: string;
    modalidad: 'focus' | 'reducido';
    activo: boolean;
  }[]
  | null;
}

interface Recuperacion {
  id: number;
  modalidad: string;
  mes_limite: number;
  anio_limite: number;
  mes_origen: number;
  anio_origen: number;
  fecha_cancelada?: string; // fecha de la sesión cancelada (YYYY-MM-DD)
}

interface RecuperacionGrupo {
  label: string;
  tipo: 'mes_pasado' | 'mes_actual' | 'futuro';
  recuperaciones: Recuperacion[];
  collapsed: boolean;
}

interface ClaseHoy {
  sesion_id: number;
  hora: string;
  modalidad: string;
  capacidad: number;
  reservas_count: number;
  alumnos: string[];
}

interface EstadisticasAdmin {
  clases_hoy: number;
  alumnos_hoy: number;
  plazas_disponibles: number;
  en_lista_espera: number;
}

@Component({
  standalone: true,
  selector: 'app-dashboard',
  imports: [CommonModule, RouterLink, NotificationPromptComponent],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  auth = inject(AuthService);

  // Estado general
  cargando = signal(true);
  tipoGrupo = signal<string | null>(null);

  // Cliente
  proximasClases = signal<ProximaClase[]>([]);
  recuperaciones = signal<Recuperacion[]>([]);
  clasesResumen = signal({ realizadas: 0, futuras: 0 });
  notificacionesNoLeidas = signal(0);

  // Stack de cards (cliente)
  activeStackIndex = signal(0);
  stackExpanded = signal(false);

  // Admin
  estadisticas = signal<EstadisticasAdmin>({
    clases_hoy: 0,
    alumnos_hoy: 0,
    plazas_disponibles: 0,
    en_lista_espera: 0,
  });
  clasesHoy = signal<ClaseHoy[]>([]);
  expandedClaseIndex = signal<number | null>(null);

  // Estados de secciones admin
  hoyExpanded = signal(false);
  clasesHoyExpanded = signal(false);
  vistaClases = signal<'hoy' | 'manana'>('hoy'); // Toggle hoy/mañana
  animatingClases = signal(false); // Para animación de transición

  // Estados de secciones cliente
  recuperacionesExpanded = signal(false);
  mesPasadoExpanded = signal(false);

  // Computed
  nombreUsuario = computed(() => this.auth.usuario()?.nombre || 'Usuario');
  userId = computed(() => this.auth.userId());

  isCliente = computed(() => this.auth.usuario()?.rol === 'cliente');
  isProfesor = computed(() => this.auth.usuario()?.rol === 'profesor');
  isAdmin = computed(() => this.auth.usuario()?.rol === 'admin');

  // Estado UI admin
  clasesHoyExpandido = signal(false);

  saludo = computed(() => {
    const hora = new Date().getHours();
    if (hora < 12) return 'Buenos días';
    if (hora < 20) return 'Buenas tardes';
    return 'Buenas noches';
  });

  tieneRecuperaciones = computed(() => this.recuperaciones().length > 0);

  // Agrupación de recuperaciones por mes
  recuperacionesAgrupadas = computed(() => {
    const recups = this.recuperaciones();
    if (recups.length === 0) return [];

    const ahora = new Date();
    const mesActual = ahora.getMonth() + 1;
    const anioActual = ahora.getFullYear();

    const mesPasado: Recuperacion[] = [];
    const mesActualArr: Recuperacion[] = [];
    const futuro: Recuperacion[] = [];

    for (const r of recups) {
      if (r.anio_origen < anioActual || (r.anio_origen === anioActual && r.mes_origen < mesActual)) {
        mesPasado.push(r);
      } else if (r.anio_origen === anioActual && r.mes_origen === mesActual) {
        mesActualArr.push(r);
      } else {
        futuro.push(r);
      }
    }

    const grupos: RecuperacionGrupo[] = [];

    if (mesPasado.length > 0) {
      // Agrupar por mes_origen para el label
      const mesOrigen = mesPasado[0].mes_origen;
      const anioOrigen = mesPasado[0].anio_origen;
      const nombreMes = this.getNombreMes(mesOrigen);
      const mesCap = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);
      grupos.push({
        label: `Pendientes de ${mesCap} ${anioOrigen !== anioActual ? anioOrigen : ''}`.trim(),
        tipo: 'mes_pasado',
        recuperaciones: mesPasado,
        collapsed: true,
      });
    }

    if (mesActualArr.length > 0) {
      const nombreMes = this.getNombreMes(mesActual);
      const mesCap = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);
      grupos.push({
        label: `Canceladas en ${mesCap}`,
        tipo: 'mes_actual',
        recuperaciones: mesActualArr,
        collapsed: false,
      });
    }

    if (futuro.length > 0) {
      grupos.push({
        label: 'Disponibles próximamente',
        tipo: 'futuro',
        recuperaciones: futuro,
        collapsed: true,
      });
    }

    return grupos;
  });

  private intervalId: ReturnType<typeof setInterval> | null = null;

  ngOnInit() {
    this.cargarDatos();

    // Actualizar notificaciones cada 30 segundos
    this.intervalId = setInterval(() => {
      this.cargarNotificacionesNoLeidas();
    }, 30000);
  }

  ngOnDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  async cargarDatos() {
    this.cargando.set(true);

    try {
      await Promise.all([this.cargarNotificacionesNoLeidas(), this.cargarDatosRol()]);
    } catch (error) {
      console.error('Error cargando datos:', error);
    } finally {
      this.cargando.set(false);
    }
  }

  async cargarDatosRol() {
    if (this.isCliente()) {
      await Promise.all([
        this.cargarTipoGrupo(),
        this.cargarProximasClases(),
        this.cargarRecuperaciones(),
        this.cargarResumenClases(),
      ]);
    } else if (this.isAdmin()) {
      await Promise.all([this.cargarEstadisticasAdmin(), this.cargarClasesHoy()]);
    }
  }

  async cargarNotificacionesNoLeidas() {
    const uid = this.userId();
    if (!uid) return;

    try {
      const { count, error } = await supabase()
        .from('notificaciones')
        .select('*', { count: 'exact', head: true })
        .eq('usuario_id', uid)
        .eq('leida', false);

      if (!error && count !== null) {
        this.notificacionesNoLeidas.set(count);
      }
    } catch (err) {
      console.error('Error cargando notificaciones:', err);
    }
  }

  async cargarTipoGrupo() {
    const uid = this.userId();
    if (!uid) return;

    try {
      const { data } = await supabase()
        .from('plan_usuario')
        .select('tipo_grupo')
        .eq('usuario_id', uid)
        .eq('activo', true)
        .single();

      if (data) {
        this.tipoGrupo.set(data.tipo_grupo);
      }
    } catch (error) {
      console.error('Error cargando tipo de grupo:', error);
    }
  }

  async cargarProximasClases() {
    const uid = this.userId();
    if (!uid) return;

    try {
      const hoyDate = new Date().toISOString().split('T')[0];
      const horariosFijos = await this.cargarClavesHorariosFijos(uid);

      const { data, error } = await supabase()
        .from('reservas')
        .select(
          `
          id,
          sesion_id,
          es_recuperacion,
          es_desde_horario_fijo,
          sesiones!inner (
            fecha,
            hora,
            modalidad,
            capacidad,
            reservas (
              estado
            )
          )
        `,
        )
        .eq('usuario_id', uid)
        .eq('estado', 'activa')
        .gte('sesiones.fecha', hoyDate)
        .order('sesiones(fecha)', { ascending: true })
        .limit(10); // Traemos más para compensar el filtrado de clases terminadas

      if (error) {
        console.error('Error cargando próximas clases:', error);
        return;
      }

      const ahora = new Date();

      const clases: ProximaClase[] = (data || [])
        .map((r) => {
          const sesion = Array.isArray(r.sesiones) ? r.sesiones[0] : r.sesiones;
          const fechaObj = new Date(sesion.fecha + 'T' + sesion.hora);
          const todasReservas = (sesion.reservas || []) as { estado: string }[];
          const reservasActivas = todasReservas.filter((res) => res.estado === 'activa').length;

          return {
            id: r.id,
            sesion_id: r.sesion_id,
            fecha: fechaObj.toLocaleDateString('es-ES', {
              day: 'numeric',
              month: 'short',
            }),
            fecha_raw: sesion.fecha,
            hora: sesion.hora.substring(0, 5),
            hora_raw: sesion.hora,
            modalidad: sesion.modalidad as 'focus' | 'reducido',
            dia_nombre: fechaObj.toLocaleDateString('es-ES', { weekday: 'long' }),
            es_recuperacion: r.es_recuperacion || false,
            es_desde_horario_fijo: r.es_desde_horario_fijo || false,
            capacidad: sesion.capacidad || 0,
            reservas_count: reservasActivas,
          };
        })
        .filter((clase) => {
          if (clase.es_desde_horario_fijo && horariosFijos.size > 0) {
            const diaSemana = this.obtenerDiaSemanaISO(clase.fecha_raw);
            const clave = this.crearClaveHorario(diaSemana, clase.hora_raw, clase.modalidad);
            if (!horariosFijos.has(clave)) return false;
          }

          // Filtrar clases que ya terminaron (1 hora después del inicio)
          const inicioClase = new Date(clase.fecha_raw + 'T' + clase.hora_raw);
          const finClase = new Date(inicioClase.getTime() + 60 * 60 * 1000); // +1 hora
          return finClase > ahora;
        })
        .sort((a, b) => {
          // Ordenar por fecha y hora
          const fechaA = new Date(a.fecha_raw + 'T' + a.hora_raw).getTime();
          const fechaB = new Date(b.fecha_raw + 'T' + b.hora_raw).getTime();
          return fechaA - fechaB;
        })
        .slice(0, 3); // Mostrar máximo 3 próximas clases

      this.proximasClases.set(clases);
    } catch (err) {
      console.error('Error:', err);
    }
  }

  private async cargarClavesHorariosFijos(usuarioId: string): Promise<Set<string>> {
    const { data, error } = await supabase()
      .from('horario_fijo_usuario')
      .select(
        `
        horarios_disponibles!inner (
          dia_semana,
          hora,
          modalidad,
          activo
        )
      `,
      )
      .eq('usuario_id', usuarioId)
      .eq('activo', true)
      .eq('horarios_disponibles.activo', true);

    if (error) {
      console.warn('No se pudieron cargar horarios fijos para validar el dashboard:', error);
      return new Set();
    }

    return new Set(
      ((data || []) as HorarioFijoDashboard[])
        .map((registro) => {
          const horario = Array.isArray(registro.horarios_disponibles)
            ? registro.horarios_disponibles[0]
            : registro.horarios_disponibles;

          if (!horario) return null;
          return this.crearClaveHorario(horario.dia_semana, horario.hora, horario.modalidad);
        })
        .filter((clave): clave is string => Boolean(clave)),
    );
  }

  private crearClaveHorario(diaSemana: number, hora: string, modalidad: string): string {
    return `${diaSemana}|${hora.substring(0, 5)}|${modalidad}`;
  }

  private obtenerDiaSemanaISO(fecha: string): number {
    const dia = new Date(`${fecha}T12:00:00`).getDay();
    return dia === 0 ? 7 : dia;
  }

  async cargarResumenClases() {
    const uid = this.userId();
    if (!uid) return;

    try {
      const { data, error } = await supabase()
        .from('reservas')
        .select(`
          estado,
          sesiones!inner (
            fecha,
            hora
          )
        `)
        .eq('usuario_id', uid)
        .eq('estado', 'activa');

      if (error) throw error;

      const ahora = new Date();
      const mesActual = ahora.getMonth();
      const anioActual = ahora.getFullYear();
      let realizadas = 0;
      let futuras = 0;

      if (data) {
        for (const r of (data as any[])) {
          const sesion = Array.isArray(r.sesiones) ? r.sesiones[0] : r.sesiones;
          if (!sesion) continue;
          
          const fechaSesion = new Date(`${sesion.fecha}T${sesion.hora}`);
          if (fechaSesion.getMonth() !== mesActual || fechaSesion.getFullYear() !== anioActual) {
            continue;
          }

          if (fechaSesion < ahora) {
            realizadas++;
          } else {
            futuras++;
          }
        }
      }

      this.clasesResumen.set({ realizadas, futuras });
    } catch (err) {
      console.error('Error cargando resumen de clases:', err);
    }
  }

  async cargarRecuperaciones() {
    const uid = this.userId();
    if (!uid) return;

    try {
      // 1. Obtener recuperaciones via RPC (tiene SECURITY DEFINER)
      const { data, error } = await supabase().rpc('obtener_recuperaciones_usuario', {
        p_usuario_id: uid,
      });

      if (error) {
        console.error('Error cargando recuperaciones:', error);
        return;
      }

      if (!data || data.length === 0) {
        this.recuperaciones.set([]);
        return;
      }

      // 2. Obtener las fechas de las sesiones canceladas
      // El RPC no devuelve sesion_cancelada_id, así que consultamos la tabla directamente
      // para obtener sesion_cancelada_id de cada recuperación por su id
      const recupIds = data.map((r: any) => r.id);
      const { data: recupDetails } = await supabase()
        .from('recuperaciones')
        .select('id, sesion_cancelada_id')
        .in('id', recupIds);

      // Obtener las fechas de las sesiones
      const sesionIds = (recupDetails || []).map((r: any) => r.sesion_cancelada_id).filter(Boolean);
      let sesionFechaMap = new Map<number, string>();

      if (sesionIds.length > 0) {
        const { data: sesionesData } = await supabase()
          .from('sesiones')
          .select('id, fecha')
          .in('id', sesionIds);

        if (sesionesData) {
          sesionFechaMap = new Map(sesionesData.map((s: any) => [s.id, s.fecha]));
        }
      }

      // Mapa de recup id -> sesion_cancelada_id
      const recupSesionMap = new Map((recupDetails || []).map((r: any) => [r.id, r.sesion_cancelada_id]));

      const recups: Recuperacion[] = data.map((r: any) => {
        const sesionCanceladaId = recupSesionMap.get(r.id);
        const fechaCancelada = sesionCanceladaId ? sesionFechaMap.get(sesionCanceladaId) : undefined;

        return {
          id: r.id,
          modalidad: r.modalidad,
          mes_limite: r.mes_limite,
          anio_limite: r.anio_limite,
          mes_origen: r.mes_origen,
          anio_origen: r.anio_origen,
          fecha_cancelada: fechaCancelada,
        };
      });

      this.recuperaciones.set(recups);
    } catch (err) {
      console.error('Error:', err);
    }
  }

  async cargarEstadisticasAdmin() {
    try {
      const hoy = new Date().toISOString().split('T')[0];

      // Sesiones de hoy
      const { data: sesionesData } = await supabase()
        .from('sesiones')
        .select('id, capacidad')
        .eq('fecha', hoy)
        .eq('cancelada', false);

      const sesiones = sesionesData || [];
      const sesionIds = sesiones.map((s) => s.id);

      // Reservas activas de hoy
      let alumnosHoy = 0;
      if (sesionIds.length > 0) {
        const { count } = await supabase()
          .from('reservas')
          .select('*', { count: 'exact', head: true })
          .in('sesion_id', sesionIds)
          .eq('estado', 'activa');

        alumnosHoy = count || 0;
      }

      // Capacidad total
      const capacidadTotal = sesiones.reduce((sum, s) => sum + s.capacidad, 0);

      // En lista de espera
      let enEspera = 0;
      if (sesionIds.length > 0) {
        const { count } = await supabase()
          .from('lista_espera')
          .select('*', { count: 'exact', head: true })
          .in('sesion_id', sesionIds);
        enEspera = count || 0;
      }

      this.estadisticas.set({
        clases_hoy: sesiones.length,
        alumnos_hoy: alumnosHoy,
        plazas_disponibles: capacidadTotal - alumnosHoy,
        en_lista_espera: enEspera,
      });
    } catch (err) {
      console.error('Error cargando estadísticas:', err);
    }
  }

  async cargarClasesHoy(vista?: 'hoy' | 'manana') {
    try {
      const hoy = new Date();
      const fechaTarget = vista === 'manana' || this.vistaClases() === 'manana'
        ? new Date(hoy.getTime() + 24 * 60 * 60 * 1000)
        : hoy;
      const fechaStr = fechaTarget.toISOString().split('T')[0];

      const { data: sesionesData, error } = await supabase()
        .from('sesiones')
        .select(
          `
          id,
          fecha,
          hora,
          modalidad,
          capacidad,
          reservas (
            id,
            usuario_id,
            estado
          )
        `,
        )
        .eq('fecha', fechaStr)
        .eq('cancelada', false)
        .order('hora', { ascending: true });

      if (error) {
        console.error('Error cargando clases:', error);
        return;
      }

      // Obtener nombres de usuarios
      const userIds = new Set<string>();
      (sesionesData || []).forEach((s) => {
        const reservas = s.reservas as { usuario_id: string; estado: string }[];
        reservas.filter((r) => r.estado === 'activa').forEach((r) => userIds.add(r.usuario_id));
      });

      const usuariosMap = new Map<string, string>();
      if (userIds.size > 0) {
        const { data: usuariosData } = await supabase()
          .from('usuarios')
          .select('id, nombre')
          .in('id', [...userIds]);

        (usuariosData || []).forEach((u) => {
          usuariosMap.set(u.id, u.nombre || 'Sin nombre');
        });
      }

      const clases: ClaseHoy[] = (sesionesData || []).map((s) => {
        const reservas = s.reservas as { usuario_id: string; estado: string }[];
        const reservasActivas = reservas.filter((r) => r.estado === 'activa');

        return {
          sesion_id: s.id,
          hora: s.hora.substring(0, 5),
          modalidad: s.modalidad,
          capacidad: s.capacidad,
          reservas_count: reservasActivas.length,
          alumnos: reservasActivas.map((r) => usuariosMap.get(r.usuario_id) || 'Sin nombre'),
        };
      });

      // Filtrar solo clases con al menos una reserva
      let clasesFiltradas = clases.filter((clase) => clase.reservas_count > 0);

      // Filtrar clases pasadas solo para hoy (no para mañana)
      if (this.vistaClases() === 'hoy') {
        const ahora = new Date();
        clasesFiltradas = clasesFiltradas.filter((clase) => {
          const inicioClase = new Date(fechaStr + 'T' + clase.hora);
          const finClase = new Date(inicioClase.getTime() + 60 * 60 * 1000); // +1 hora
          return finClase > ahora;
        });
      }

      this.clasesHoy.set(clasesFiltradas);
    } catch (err) {
      console.error('Error:', err);
    }
  }

  // ============ MÉTODOS STACK DE CARDS (CLIENTE) ============

  toggleStack() {
    this.stackExpanded.update((v) => !v);
  }

  setActiveStackIndex(index: number) {
    this.activeStackIndex.set(index);
  }

  getDiasHasta(clase: ProximaClase): string {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const fechaClase = new Date(clase.fecha_raw);
    fechaClase.setHours(0, 0, 0, 0);

    const diffTime = fechaClase.getTime() - hoy.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'hoy';
    if (diffDays === 1) return 'mañana';
    if (diffDays < 7) return `${diffDays} días`;

    const semanas = Math.floor(diffDays / 7);
    return semanas === 1 ? '1 semana' : `${semanas} semanas`;
  }

  // ============ MÉTODOS CARDS EXPANDIBLES (ADMIN) ============

  toggleClasesHoy() {
    this.clasesHoyExpandido.update(v => !v);
  }

  toggleClaseExpand(index: number) {
    if (this.expandedClaseIndex() === index) {
      this.expandedClaseIndex.set(null);
    } else {
      this.expandedClaseIndex.set(index);
    }
  }

  toggleHoySection() {
    this.hoyExpanded.update((v) => !v);
  }

  toggleClasesHoySection() {
    this.clasesHoyExpanded.update((v) => !v);
  }

  setVistaClases(vista: 'hoy' | 'manana') {
    if (this.vistaClases() === vista) return;
    this.animatingClases.set(true);
    this.expandedClaseIndex.set(null); // Reset expanded card

    // Breve fade-out, luego cambiar datos y fade-in
    setTimeout(() => {
      this.vistaClases.set(vista);
      this.cargarClasesHoy(vista).then(() => {
        // Pequeño delay para que Angular renderice el nuevo contenido
        setTimeout(() => this.animatingClases.set(false), 30);
      });
    }, 150);
  }

  toggleRecuperacionesSection() {
    this.recuperacionesExpanded.update((v) => !v);
  }

  toggleMesPasadoSection() {
    this.mesPasadoExpanded.update((v) => !v);
  }

  getFechaCanceladaTexto(recup: Recuperacion): string {
    if (!recup.fecha_cancelada) return '';
    const fecha = new Date(recup.fecha_cancelada + 'T12:00:00');
    const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };
    const texto = fecha.toLocaleDateString('es-ES', options);
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  getOcupacionPercent(clase: ClaseHoy): number {
    if (clase.capacidad === 0) return 0;
    return Math.round((clase.reservas_count / clase.capacidad) * 100);
  }

  // ============ HELPERS GENERALES ============

  getRoleLabel(): string {
    const rol = this.auth.usuario()?.rol;

    if (rol === 'admin') return 'Admin';
    if (rol === 'profesor') return 'Profesor';

    const grupo = this.tipoGrupo();
    if (grupo === 'focus') return 'Focus';
    if (grupo === 'reducido') return 'Reducido';
    if (grupo === 'hibrido') return 'Híbrido';
    if (grupo === 'especial') return 'Especial';

    return 'Cliente';
  }

  getRoleBadgeClass(): string {
    const rol = this.auth.usuario()?.rol;

    if (rol === 'admin') return 'badge badge--admin';
    if (rol === 'profesor') return 'badge badge--profesor';

    const grupo = this.tipoGrupo();
    if (grupo === 'focus') return 'badge badge--focus';
    if (grupo === 'reducido') return 'badge badge--reducido';
    if (grupo === 'hibrido') return 'badge badge--hibrido';
    if (grupo === 'especial') return 'badge badge--especial';

    return 'badge badge--focus';
  }

  getNombreMes(mes: number): string {
    const meses = [
      'enero',
      'febrero',
      'marzo',
      'abril',
      'mayo',
      'junio',
      'julio',
      'agosto',
      'septiembre',
      'octubre',
      'noviembre',
      'diciembre',
    ];
    return meses[mes - 1] || '';
  }

  esRecuperacionFutura(recup: Recuperacion): boolean {
    const ahora = new Date();
    const mesActual = ahora.getMonth() + 1;
    const anioActual = ahora.getFullYear();

    if (recup.anio_origen > anioActual) return true;
    if (recup.anio_origen === anioActual && recup.mes_origen > mesActual) return true;

    return false;
  }

  getUltimoDiaHabil(mes: number, anio: number): number {
    const ultimoDia = new Date(anio, mes, 0);
    const diaSemana = ultimoDia.getDay();

    if (diaSemana === 6) {
      return ultimoDia.getDate() - 1;
    } else if (diaSemana === 0) {
      return ultimoDia.getDate() - 2;
    }

    return ultimoDia.getDate();
  }

  getTextoValidez(recup: Recuperacion): string {
    if (this.esRecuperacionFutura(recup)) {
      const nombreMes = this.getNombreMes(recup.mes_origen);
      const mesCap = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);
      return `Disponible a partir de ${mesCap}`;
    }

    if (recup.mes_limite === recup.mes_origen && recup.anio_limite === recup.anio_origen) {
      return 'Válida este mes';
    }

    const nombreMes = this.getNombreMes(recup.mes_limite);
    const mesCap = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);

    return `Válida para ${mesCap}`;
  }

  irANotificaciones() {
    this.router.navigateByUrl('/notificaciones');
  }

  trackByClaseId(_index: number, clase: ProximaClase | ClaseHoy): number {
    return 'id' in clase ? clase.id : clase.sesion_id;
  }

  trackByRecupId(_index: number, recup: Recuperacion): number {
    return recup.id;
  }
}
