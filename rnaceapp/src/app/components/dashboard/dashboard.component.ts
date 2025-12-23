// src/app/components/dashboard/dashboard.component.ts
import { CommonModule } from '@angular/common';
import { Component, inject, computed, signal, OnInit, OnDestroy } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { supabase } from '../../core/supabase.client';

interface ProximaClase {
  id: number;
  sesion_id: number;
  fecha: string;
  fecha_raw: string; // Para calcular días hasta
  hora: string;
  modalidad: 'focus' | 'reducido';
  dia_nombre: string;
  es_recuperacion: boolean;
}

interface Recuperacion {
  id: number;
  modalidad: string;
  mes_limite: number;
  anio_limite: number;
  mes_origen: number;
  anio_origen: number;
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
  imports: [CommonModule, RouterLink],
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

  // Computed
  nombreUsuario = computed(() => this.auth.usuario()?.nombre || 'Usuario');
  userId = computed(() => this.auth.userId());

  isCliente = computed(() => this.auth.usuario()?.rol === 'cliente');
  isProfesor = computed(() => this.auth.usuario()?.rol === 'profesor');
  isAdmin = computed(() => this.auth.usuario()?.rol === 'admin');

  saludo = computed(() => {
    const hora = new Date().getHours();
    if (hora < 12) return 'Buenos días';
    if (hora < 20) return 'Buenas tardes';
    return 'Buenas noches';
  });

  tieneRecuperaciones = computed(() => this.recuperaciones().length > 0);

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

      const { data, error } = await supabase()
        .from('reservas')
        .select(
          `
          id,
          sesion_id,
          es_recuperacion,
          sesiones!inner (
            fecha,
            hora,
            modalidad
          )
        `,
        )
        .eq('usuario_id', uid)
        .eq('estado', 'activa')
        .gte('sesiones.fecha', hoyDate)
        .order('sesiones(fecha)', { ascending: true })
        .limit(3);

      if (error) {
        console.error('Error cargando próximas clases:', error);
        return;
      }

      const clases: ProximaClase[] = (data || []).map((r) => {
        const sesion = Array.isArray(r.sesiones) ? r.sesiones[0] : r.sesiones;
        const fechaObj = new Date(sesion.fecha + 'T' + sesion.hora);

        return {
          id: r.id,
          sesion_id: r.sesion_id,
          fecha: fechaObj.toLocaleDateString('es-ES', {
            day: 'numeric',
            month: 'short',
          }),
          fecha_raw: sesion.fecha,
          hora: sesion.hora.substring(0, 5),
          modalidad: sesion.modalidad as 'focus' | 'reducido',
          dia_nombre: fechaObj.toLocaleDateString('es-ES', { weekday: 'long' }),
          es_recuperacion: r.es_recuperacion || false,
        };
      });

      this.proximasClases.set(clases);
    } catch (err) {
      console.error('Error:', err);
    }
  }

  async cargarRecuperaciones() {
    const uid = this.userId();
    if (!uid) return;

    try {
      const { data, error } = await supabase().rpc('obtener_recuperaciones_usuario', {
        p_usuario_id: uid,
      });

      if (error) {
        console.error('Error cargando recuperaciones:', error);
        return;
      }

      this.recuperaciones.set(data || []);
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

  async cargarClasesHoy() {
    try {
      const hoy = new Date().toISOString().split('T')[0];

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
        .eq('fecha', hoy)
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

      this.clasesHoy.set(clases);
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

  toggleClaseExpand(index: number) {
    if (this.expandedClaseIndex() === index) {
      this.expandedClaseIndex.set(null);
    } else {
      this.expandedClaseIndex.set(index);
    }
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
      return 'Válida para el mes en curso';
    }

    const dia = this.getUltimoDiaHabil(recup.mes_limite, recup.anio_limite);
    const nombreMes = this.getNombreMes(recup.mes_limite);
    const mesCap = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);

    return `Válida hasta el día ${dia} de ${mesCap}`;
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