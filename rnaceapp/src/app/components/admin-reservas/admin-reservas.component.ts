// src/app/components/admin-reservas/admin-reservas.component.ts
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { supabase } from '../../core/supabase.client';

type VistaActual = 'grupos' | 'usuarios' | 'reservas';
type TipoGrupo = 'focus' | 'reducido' | 'hibrido' | 'especial';

interface GrupoStats {
  tipo: TipoGrupo;
  nombre: string;
  icono: string;
  color: string;
  totalUsuarios: number;
  totalReservas: number;
}

interface UsuarioGrupo {
  id: string;
  nombre: string;
  telefono: string;
  tipoGrupo: string;
}

interface Reserva {
  id: number;
  sesion_id: number;
  fecha: string;
  hora: string;
  modalidad: string;
  es_recuperacion: boolean;
}

interface SesionDisponible {
  id: number;
  fecha: string;
  hora: string;
  modalidad: string;
  plazas_disponibles: number;
}

interface ReservaSupabaseResponse {
  id: number;
  sesion_id: number;
  es_recuperacion: boolean;
  sesiones:
  | { fecha: string; hora: string; modalidad: string }
  | { fecha: string; hora: string; modalidad: string }[];
}

@Component({
  standalone: true,
  selector: 'app-admin-reservas',
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-reservas.component.html',
  styleUrls: ['./admin-reservas.component.scss'],
})
export class AdminReservasComponent implements OnInit {
  private router = inject(Router);

  cargando = signal(false);
  error = signal<string | null>(null);
  mensajeExito = signal<string | null>(null);

  // Navegación de meses
  mesActual = signal({ anio: new Date().getFullYear(), mes: new Date().getMonth() + 1 });

  nombreMes = computed(() => {
    const { anio, mes } = this.mesActual();
    const fecha = new Date(anio, mes - 1, 1);
    const nombreMes = fecha.toLocaleDateString('es-ES', { month: 'long' });
    return `${nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1)} ${anio}`;
  });

  // Navegación entre vistas
  vistaActual = signal<VistaActual>('grupos');
  grupoSeleccionado = signal<TipoGrupo | null>(null);
  usuarioSeleccionado = signal<UsuarioGrupo | null>(null);

  // Datos
  grupos = signal<GrupoStats[]>([]);
  usuariosGrupo = signal<UsuarioGrupo[]>([]);
  reservasUsuario = signal<Reserva[]>([]);

  // Modal mover
  mostrarModalMover = signal(false);
  reservaAMover = signal<Reserva | null>(null);
  sesionesDisponibles = signal<SesionDisponible[]>([]);
  sesionDestino = signal<number | null>(null);
  moviendo = signal(false);

  // Modal eliminar
  mostrarModalEliminar = signal(false);
  reservaAEliminar = signal<Reserva | null>(null);
  eliminando = signal(false);

  ngOnInit() {
    this.cargarGrupos();
  }

  // === NAVEGACIÓN DE MESES ===
  mesAnterior() {
    const { anio, mes } = this.mesActual();
    if (mes === 1) {
      this.mesActual.set({ anio: anio - 1, mes: 12 });
    } else {
      this.mesActual.set({ anio, mes: mes - 1 });
    }
    this.recargarVistaActual();
  }

  mesSiguiente() {
    const { anio, mes } = this.mesActual();
    if (mes === 12) {
      this.mesActual.set({ anio: anio + 1, mes: 1 });
    } else {
      this.mesActual.set({ anio, mes: mes + 1 });
    }
    this.recargarVistaActual();
  }

  private recargarVistaActual() {
    const vista = this.vistaActual();
    if (vista === 'grupos') {
      this.cargarGrupos();
    } else if (vista === 'usuarios') {
      const grupo = this.grupoSeleccionado();
      if (grupo) this.cargarUsuariosGrupo(grupo);
    } else if (vista === 'reservas') {
      const usuario = this.usuarioSeleccionado();
      if (usuario) this.cargarReservasUsuario(usuario);
    }
  }

  // === CARGA DE DATOS ===
  async cargarGrupos() {
    this.cargando.set(true);
    this.error.set(null);

    try {
      const { anio, mes } = this.mesActual();
      const inicioMes = `${anio}-${mes.toString().padStart(2, '0')}-01`;
      const finMes = new Date(anio, mes, 0).toISOString().split('T')[0];

      // Contar usuarios por tipo de grupo
      const { data: planesData } = await supabase()
        .from('plan_usuario')
        .select('tipo_grupo, usuario_id')
        .eq('activo', true);

      const conteoUsuarios = new Map<string, number>();
      if (planesData) {
        for (const plan of planesData) {
          const tipo = plan.tipo_grupo || 'sin_plan';
          conteoUsuarios.set(tipo, (conteoUsuarios.get(tipo) || 0) + 1);
        }
      }

      // Contar reservas del mes por tipo de grupo
      const { data: reservasData } = await supabase()
        .from('reservas')
        .select(
          `
          id,
          usuario_id,
          sesiones!inner(fecha)
        `,
        )
        .eq('estado', 'activa')
        .gte('sesiones.fecha', inicioMes)
        .lte('sesiones.fecha', finMes + 'T23:59:59');

      // Mapear usuarios a sus grupos
      const usuarioGrupo = new Map<string, string>();
      if (planesData) {
        for (const plan of planesData) {
          usuarioGrupo.set(plan.usuario_id, plan.tipo_grupo);
        }
      }

      const conteoReservas = new Map<string, number>();
      if (reservasData) {
        for (const reserva of reservasData) {
          const grupo = usuarioGrupo.get(reserva.usuario_id) || 'sin_plan';
          conteoReservas.set(grupo, (conteoReservas.get(grupo) || 0) + 1);
        }
      }

      const gruposConfig: { tipo: TipoGrupo; nombre: string; icono: string; color: string }[] = [
        { tipo: 'focus', nombre: 'Focus', icono: 'fitness_center', color: '#60a5fa' },
        { tipo: 'reducido', nombre: 'Reducido', icono: 'groups', color: '#a78bfa' },
        { tipo: 'hibrido', nombre: 'Híbrido', icono: 'swap_horiz', color: '#4ade80' },
        { tipo: 'especial', nombre: 'Especial', icono: 'star', color: '#fbbf24' },
      ];

      const grupos: GrupoStats[] = gruposConfig.map((g) => ({
        ...g,
        totalUsuarios: conteoUsuarios.get(g.tipo) || 0,
        totalReservas: conteoReservas.get(g.tipo) || 0,
      }));

      this.grupos.set(grupos);
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error al cargar los grupos.');
    } finally {
      this.cargando.set(false);
    }
  }

  async cargarUsuariosGrupo(tipo: TipoGrupo) {
    this.cargando.set(true);
    this.grupoSeleccionado.set(tipo);
    this.vistaActual.set('usuarios');

    try {
      const { data: planesData } = await supabase()
        .from('plan_usuario')
        .select('usuario_id, tipo_grupo')
        .eq('tipo_grupo', tipo)
        .eq('activo', true);

      if (!planesData || planesData.length === 0) {
        this.usuariosGrupo.set([]);
        return;
      }

      const userIds = planesData.map((p) => p.usuario_id);

      const { data: usuariosData } = await supabase()
        .from('usuarios')
        .select('id, nombre, telefono')
        .in('id', userIds)
        .eq('activo', true)
        .order('nombre');

      const usuarios: UsuarioGrupo[] = (usuariosData || []).map((u) => ({
        id: u.id,
        nombre: u.nombre || 'Sin nombre',
        telefono: u.telefono || '',
        tipoGrupo: tipo,
      }));

      this.usuariosGrupo.set(usuarios);
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error al cargar usuarios.');
    } finally {
      this.cargando.set(false);
    }
  }

  async cargarReservasUsuario(usuario: UsuarioGrupo) {
    this.cargando.set(true);
    this.usuarioSeleccionado.set(usuario);
    this.vistaActual.set('reservas');

    try {
      const { anio, mes } = this.mesActual();
      const inicioMes = `${anio}-${mes.toString().padStart(2, '0')}-01`;
      const finMes = new Date(anio, mes, 0).toISOString().split('T')[0];

      const { data } = await supabase()
        .from('reservas')
        .select(
          `
          id,
          sesion_id,
          es_recuperacion,
          sesiones!inner(fecha, hora, modalidad)
        `,
        )
        .eq('usuario_id', usuario.id)
        .eq('estado', 'activa')
        .gte('sesiones.fecha', inicioMes)
        .lte('sesiones.fecha', finMes + 'T23:59:59')
        .order('sesiones(fecha)', { ascending: true });

      const reservas: Reserva[] = (data || []).map((r: ReservaSupabaseResponse) => {
        // Supabase con !inner puede devolver objeto o array según la configuración
        const sesion = Array.isArray(r.sesiones) ? r.sesiones[0] : r.sesiones;
        const fechaInicio = new Date(sesion.fecha);
        return {
          id: r.id,
          sesion_id: r.sesion_id,
          fecha: fechaInicio.toLocaleDateString('es-ES', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          }),
          hora: sesion.hora?.slice(0, 5) || '--:--',
          modalidad: sesion.modalidad,
          es_recuperacion: r.es_recuperacion || false,
        };
      });

      this.reservasUsuario.set(reservas);
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error al cargar reservas.');
    } finally {
      this.cargando.set(false);
    }
  }

  // === NAVEGACIÓN ===
  seleccionarGrupo(grupo: GrupoStats) {
    if (grupo.totalUsuarios > 0) {
      this.cargarUsuariosGrupo(grupo.tipo);
    }
  }

  seleccionarUsuario(usuario: UsuarioGrupo) {
    this.cargarReservasUsuario(usuario);
  }

  volverAGrupos() {
    this.vistaActual.set('grupos');
    this.grupoSeleccionado.set(null);
    this.usuarioSeleccionado.set(null);
    this.mensajeExito.set(null);
    this.cargarGrupos();
  }

  volverAUsuarios() {
    this.vistaActual.set('usuarios');
    this.usuarioSeleccionado.set(null);
    this.mensajeExito.set(null);
    const grupo = this.grupoSeleccionado();
    if (grupo) this.cargarUsuariosGrupo(grupo);
  }

  volver() {
    this.router.navigateByUrl('/dashboard');
  }

  // === MODAL MOVER ===
  async abrirModalMover(reserva: Reserva) {
    this.reservaAMover.set(reserva);
    this.sesionDestino.set(null);
    this.mostrarModalMover.set(true);

    // Cargar sesiones disponibles de la misma modalidad
    const { anio, mes } = this.mesActual();
    const finMes = new Date(anio, mes, 0).toISOString().split('T')[0];
    const hoy = new Date().toISOString().split('T')[0]; // Fecha de hoy

    const { data } = await supabase()
      .from('vista_sesiones_disponibilidad')
      .select('*')
      .eq('modalidad', reserva.modalidad)
      .gte('fecha', hoy) // NUEVO: Solo sesiones futuras o de hoy
      .lte('fecha', finMes)
      .gt('plazas_disponibles', 0)
      .neq('sesion_id', reserva.sesion_id)
      .order('fecha', { ascending: true })
      .order('hora', { ascending: true });

    const sesiones: SesionDisponible[] = (data || []).map(
      (s: {
        sesion_id: number;
        fecha: string;
        hora: string;
        modalidad: string;
        plazas_disponibles: number;
      }) => ({
        id: s.sesion_id,
        fecha: new Date(s.fecha + 'T12:00:00').toLocaleDateString('es-ES', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        }),
        hora: s.hora,
        modalidad: s.modalidad,
        plazas_disponibles: s.plazas_disponibles,
      }),
    );

    this.sesionesDisponibles.set(sesiones);
  }

  cerrarModalMover() {
    this.mostrarModalMover.set(false);
    this.reservaAMover.set(null);
    this.sesionDestino.set(null);
  }

  async confirmarMover() {
    const reserva = this.reservaAMover();
    const destino = this.sesionDestino();
    if (!reserva || !destino) return;

    this.moviendo.set(true);

    try {
      const { error } = await supabase()
        .from('reservas')
        .update({ sesion_id: destino })
        .eq('id', reserva.id);

      if (error) {
        this.error.set('Error al mover la reserva: ' + error.message);
        return;
      }

      this.mensajeExito.set('Reserva movida correctamente.');
      this.cerrarModalMover();

      const usuario = this.usuarioSeleccionado();
      if (usuario) this.cargarReservasUsuario(usuario);
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error inesperado al mover la reserva.');
    } finally {
      this.moviendo.set(false);
    }
  }

  // === MODAL ELIMINAR ===
  abrirModalEliminar(reserva: Reserva) {
    this.reservaAEliminar.set(reserva);
    this.mostrarModalEliminar.set(true);
  }

  cerrarModalEliminar() {
    this.mostrarModalEliminar.set(false);
    this.reservaAEliminar.set(null);
  }

  async confirmarEliminar(generarRecuperacion: boolean) {
    const reserva = this.reservaAEliminar();
    const usuario = this.usuarioSeleccionado();
    if (!reserva) return;

    this.eliminando.set(true);
    this.error.set(null);

    try {
      const { data, error } = await supabase().rpc('cancelar_reserva_admin', {
        p_reserva_id: reserva.id,
        p_generar_recuperacion: generarRecuperacion
      });

      if (error) {
        console.error('Error RPC:', error);
        this.error.set('Error al eliminar la reserva: ' + error.message);
        return;
      }

      if (data && data.length > 0 && data[0].ok) {
        this.mensajeExito.set(data[0].mensaje);
        this.cerrarModalEliminar();

        // Enviar push notification al usuario afectado
        if (usuario) {
          try {
            await supabase().functions.invoke('send-push', {
              body: {
                user_id: usuario.id,
                tipo: 'reserva_cancelada',
                data: { mensaje: data[0].mensaje }
              }
            });
          } catch (pushErr) {
            console.warn('[Push] Error enviando push cancelación admin:', pushErr);
          }
        }

        if (usuario) this.cargarReservasUsuario(usuario);
      } else {
        this.error.set(data?.[0]?.mensaje || 'Error al eliminar la reserva');
      }
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error inesperado al eliminar la reserva.');
    } finally {
      this.eliminando.set(false);
    }
  }

  // === UTILIDADES ===
  getNombreGrupo(): string {
    const grupo = this.grupoSeleccionado();
    if (!grupo) return '';
    const nombres: Record<TipoGrupo, string> = {
      focus: 'Focus',
      reducido: 'Reducido',
      hibrido: 'Híbrido',
      especial: 'Especial',
    };
    return nombres[grupo];
  }
}
