// src/app/components/notificaciones/notificaciones.component.ts
import { CommonModule, Location } from '@angular/common';
import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { supabase } from '../../core/supabase.client';
import { ConfirmationService } from '../../shared/confirmation-modal/confirmation.service';
import { PushNotificationService } from '../../core/push-notification.service';
import { Subscription } from 'rxjs';

interface Notificacion {
  id: number;
  tipo: string;
  titulo: string;
  mensaje: string;
  sesion_id: number | null;
  accion_url: string | null;
  leida: boolean;
  creado_en: string;
  tiempo_relativo: string;
}

@Component({
  standalone: true,
  selector: 'app-notificaciones',
  imports: [CommonModule],
  templateUrl: './notificaciones.component.html',
  styleUrls: ['./notificaciones.component.scss'],
})
export class NotificacionesComponent implements OnInit, OnDestroy {
  private auth = inject(AuthService);
  private router = inject(Router);
  private location = inject(Location);
  private confirmation = inject(ConfirmationService);
  private pushService = inject(PushNotificationService);

  private subscriptions: Subscription[] = [];


  // Estado
  cargando = signal(true);
  error = signal<string | null>(null);
  mensajeExito = signal<string | null>(null);

  // Datos
  notificaciones = signal<Notificacion[]>([]);
  // ... (unchanged code) ...

  // (Jump directly to existing eliminarNotificacion content, replacing it)
  async eliminarNotificacion(notificacion: Notificacion, event?: Event) {
    if (event) {
      event.stopPropagation();
    }

    const confirmado = await this.confirmation.confirm({
      titulo: 'Eliminar notificación',
      mensaje: '¿Estás seguro de que deseas eliminar esta notificación?',
      tipo: 'danger',
      textoConfirmar: 'Eliminar',
      textoCancelar: 'Cancelar',
    });

    if (!confirmado) {
      return;
    }

    const uid = this.userId();
    if (!uid) return;

    // ... (rest of the function is the same, just keeping it consistent)
    try {
      const { data, error } = await supabase().rpc('eliminar_notificacion', {
        p_notificacion_id: notificacion.id,
      });

      if (error) {
        console.error('Error eliminando notificación:', error);
        this.error.set('Error al eliminar la notificación');
        return;
      }

      if (data && data[0]?.ok) {
        // Eliminar de la lista local
        this.notificaciones.update((lista) => lista.filter((n) => n.id !== notificacion.id));
        this.mensajeExito.set('Notificación eliminada');

        // Si estaba abierta en el modal, cerrarlo
        if (this.modalAbierto() && this.notificacionSeleccionada()?.id === notificacion.id) {
          this.cerrarModal();
        }

        setTimeout(() => this.mensajeExito.set(null), 3000);
      } else {
        this.error.set(data?.[0]?.mensaje || 'No se pudo eliminar');
      }
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error inesperado al eliminar');
    }
  }

  // Filtro activo: 'todas' | 'no_leidas' | 'leidas'
  filtroActivo = signal<'todas' | 'no_leidas' | 'leidas'>('todas');

  // Filtro por tipo (categoría)
  filtroTipo = signal<string>('todos');

  // Modal Detalle
  modalAbierto = signal(false);
  notificacionSeleccionada = signal<Notificacion | null>(null);
  detalleSesion = signal<{ fecha: string; hora: string; modalidad: string } | null>(null);

  // Push notifications state
  pushSupported = signal(false);
  pushEnabled = signal(false);
  pushPermission = signal<NotificationPermission>('default');
  togglingPush = signal(false);

  // Computed
  userId = computed(() => this.auth.userId());
  esAdmin = computed(() => this.auth.getRol() === 'admin');

  noLeidas = computed(() => this.notificaciones().filter((n) => !n.leida).length);
  leidas = computed(() => this.notificaciones().filter((n) => n.leida).length);

  // Notificaciones filtradas según el filtro activo
  notificacionesFiltradas = computed(() => {
    const todas = this.notificaciones();
    const filtro = this.filtroActivo();

    const filtroLeida = this.filtroActivo();
    const filtroCategoria = this.filtroTipo();

    let resultado = todas;

    // 1. Filtrar por estado (leída/no leída)
    if (filtroLeida === 'no_leidas') {
      resultado = resultado.filter((n) => !n.leida);
    } else if (filtroLeida === 'leidas') {
      resultado = resultado.filter((n) => n.leida);
    }

    // 2. Filtrar por tipo
    if (filtroCategoria !== 'todos') {
      if (filtroCategoria === 'avisos') {
        resultado = resultado.filter(n => n.tipo.startsWith('admin_'));
      } else if (filtroCategoria === 'clases') {
        resultado = resultado.filter(n => ['hueco_disponible', 'plaza_disponible', 'plaza_asignada', 'cancelacion', 'recuperacion', 'lista_espera', 'recordatorio'].includes(n.tipo));
      } else if (filtroCategoria === 'festivos') {
        resultado = resultado.filter(n => n.tipo === 'festivo');
      }
    }

    return resultado;
  });

  notificacionesAgrupadas = computed(() => {
    const todas = this.notificacionesFiltradas();
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const ayer = new Date(hoy);
    ayer.setDate(ayer.getDate() - 1);

    const semana = new Date(hoy);
    semana.setDate(semana.getDate() - 7);

    const grupos: { titulo: string; items: Notificacion[] }[] = [
      { titulo: 'Hoy', items: [] },
      { titulo: 'Ayer', items: [] },
      { titulo: 'Esta semana', items: [] },
      { titulo: 'Anteriores', items: [] },
    ];

    todas.forEach((n) => {
      const fecha = new Date(n.creado_en);
      fecha.setHours(0, 0, 0, 0);

      if (fecha.getTime() >= hoy.getTime()) {
        grupos[0].items.push(n);
      } else if (fecha.getTime() >= ayer.getTime()) {
        grupos[1].items.push(n);
      } else if (fecha.getTime() >= semana.getTime()) {
        grupos[2].items.push(n);
      } else {
        grupos[3].items.push(n);
      }
    });

    return grupos.filter((g) => g.items.length > 0);
  });

  ngOnInit() {
    this.cargarNotificaciones();
    this.setupPushSubscriptions();
  }

  ngOnDestroy() {
    this.subscriptions.forEach(s => s.unsubscribe());
  }

  private setupPushSubscriptions() {
    this.subscriptions.push(
      this.pushService.isSupported$.subscribe(supported => {
        this.pushSupported.set(supported);
      }),
      this.pushService.permissionStatus$.subscribe(status => {
        this.pushPermission.set(status);
        this.updatePushEnabled();
      }),
      this.pushService.currentToken$.subscribe(() => {
        this.updatePushEnabled();
      })
    );
    // Initial check
    this.pushSupported.set(this.pushService.isSupported());
    this.updatePushEnabled();
  }

  private updatePushEnabled() {
    const enabled = this.pushService.isEffectivelyEnabled();
    this.pushEnabled.set(enabled);
  }

  async togglePush() {
    this.togglingPush.set(true);
    try {
      if (this.pushEnabled()) {
        // Disable notifications
        await this.pushService.optOutNotifications();
        this.pushEnabled.set(false);
      } else {
        // Enable notifications
        const success = await this.pushService.optInNotifications();
        this.pushEnabled.set(success);
        if (!success && this.pushPermission() === 'denied') {
          this.error.set('Las notificaciones están bloqueadas en tu navegador');
          setTimeout(() => this.error.set(null), 4000);
        }
      }
    } finally {
      this.togglingPush.set(false);
    }
  }

  async cargarNotificaciones() {
    const uid = this.userId();
    if (!uid) return;

    this.cargando.set(true);
    this.error.set(null);

    try {
      const { data, error } = await supabase()
        .from('notificaciones')
        .select('*')
        .eq('usuario_id', uid)
        .order('creado_en', { ascending: false })
        .limit(50);

      if (error) {
        console.error('Error cargando notificaciones:', error);
        this.error.set('Error al cargar notificaciones');
        return;
      }

      const notificaciones: Notificacion[] = (data || []).map((n) => ({
        ...n,
        tiempo_relativo: this.calcularTiempoRelativo(n.creado_en),
      }));

      this.notificaciones.set(notificaciones);
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error inesperado');
    } finally {
      this.cargando.set(false);
    }
  }

  calcularTiempoRelativo(fecha: string): string {
    const ahora = new Date();
    const fechaNotif = new Date(fecha);
    const diffMs = ahora.getTime() - fechaNotif.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHoras = Math.floor(diffMins / 60);
    const diffDias = Math.floor(diffHoras / 24);

    if (diffMins < 1) return 'Ahora';
    if (diffMins < 60) return `Hace ${diffMins} min`;
    if (diffHoras < 24) return `Hace ${diffHoras}h`;
    if (diffDias === 1) return 'Ayer';
    if (diffDias < 7) return `Hace ${diffDias} días`;

    return fechaNotif.toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
    });
  }

  formatearFechaCompleta(fecha: string): string {
    const d = new Date(fecha);
    const fechaStr = d.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const horaStr = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    // Capitalize first letter
    return (fechaStr.charAt(0).toUpperCase() + fechaStr.slice(1)) + ' - ' + horaStr;
  }

  formatearFechaSesion(fecha: string): string {
    // Añadir hora para evitar problemas de timezone
    const d = new Date(fecha + 'T12:00:00');
    const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };
    const formatted = d.toLocaleDateString('es-ES', options);
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  }

  async marcarComoLeida(notificacion: Notificacion) {
    if (notificacion.leida) return;

    try {
      const { error } = await supabase()
        .from('notificaciones')
        .update({ leida: true })
        .eq('id', notificacion.id);

      if (!error) {
        this.notificaciones.update((lista) =>
          lista.map((n) => (n.id === notificacion.id ? { ...n, leida: true } : n)),
        );
      }
    } catch (err) {
      console.error('Error marcando como leída:', err);
    }
  }

  async marcarTodasLeidas() {
    const uid = this.userId();
    if (!uid) return;

    try {
      const { error } = await supabase()
        .from('notificaciones')
        .update({ leida: true })
        .eq('usuario_id', uid)
        .eq('leida', false);

      if (!error) {
        this.notificaciones.update((lista) => lista.map((n) => ({ ...n, leida: true })));
        this.mensajeExito.set('Todas las notificaciones marcadas como leídas');
        setTimeout(() => this.mensajeExito.set(null), 3000);
      }
    } catch (err) {
      console.error('Error:', err);
    }
  }

  cambiarFiltro(filtro: 'todas' | 'no_leidas' | 'leidas') {
    this.filtroActivo.set(filtro);
  }

  cambiarFiltroTipo(tipo: string) {
    this.filtroTipo.set(tipo);
  }

  async onClickNotificacion(notificacion: Notificacion) {
    this.marcarComoLeida(notificacion);
    this.notificacionSeleccionada.set(notificacion);

    // Si es una notificación de plaza disponible o lista de espera, cargar detalles de la sesión
    if ((notificacion.tipo === 'plaza_disponible' || notificacion.tipo === 'lista_espera') && notificacion.sesion_id) {
      try {
        const { data } = await supabase()
          .from('sesiones')
          .select('fecha, hora, modalidad')
          .eq('id', notificacion.sesion_id)
          .single();

        if (data) {
          this.detalleSesion.set({
            fecha: data.fecha,
            hora: data.hora.slice(0, 5), // Quitar segundos
            modalidad: data.modalidad
          });
        }
      } catch (e) {
        console.error('Error cargando detalle sesión notif:', e);
      }
    }

    this.modalAbierto.set(true);
  }

  cerrarModal() {
    this.modalAbierto.set(false);
    this.notificacionSeleccionada.set(null);
    this.detalleSesion.set(null);
  }

  ejecutarAccion(notificacion: Notificacion) {
    this.cerrarModal();

    // Para notificaciones de plaza disponible, navegar al calendario con el sesion_id
    if ((notificacion.tipo === 'plaza_disponible' || notificacion.tipo === 'lista_espera') && notificacion.sesion_id) {
      this.router.navigate(['/calendario'], {
        queryParams: { sesion: notificacion.sesion_id }
      });
      return;
    }

    // Para otras notificaciones con accion_url
    if (notificacion.accion_url) {
      this.router.navigateByUrl(notificacion.accion_url);
    }
  }

  getIcono(tipo: string): string {
    switch (tipo) {
      case 'hueco_disponible':
      case 'plaza_disponible':
        return 'event_available';
      case 'festivo':
        return 'event_busy';
      case 'cancelacion':
        return 'cancel';
      case 'recordatorio':
        return 'notifications_active';
      case 'recuperacion':
        return 'replay';
      case 'lista_espera':
        return 'hourglass_top';
      case 'plaza_asignada':
        return 'check_circle';
      case 'admin_info':
        return 'info';
      case 'admin_warning':
        return 'warning';
      case 'admin_urgent':
        return 'report';
      case 'admin_promo':
        return 'celebration';
      default:
        return 'notifications';
    }
  }

  getClaseTipo(tipo: string): string {
    switch (tipo) {
      case 'hueco_disponible':
      case 'plaza_disponible':
      case 'plaza_asignada':
        return 'tipo-disponible';
      case 'festivo':
        return 'tipo-festivo';
      case 'cancelacion':
        return 'tipo-cancelacion';
      case 'recuperacion':
        return 'tipo-recuperacion';
      case 'admin_info':
      case 'admin_warning':
      case 'admin_urgent':
      case 'admin_promo':
        return tipo; // Usamos el mismo nombre como clase
      default:
        return 'tipo-default';
    }
  }

  irAEnviarAviso() {
    this.router.navigateByUrl('/admin-avisos');
  }

  volver() {
    this.location.back();
  }

  trackById(_index: number, item: Notificacion): number {
    return item.id;
  }

  trackByTitulo(_index: number, grupo: { titulo: string }): string {
    return grupo.titulo;
  }


}
