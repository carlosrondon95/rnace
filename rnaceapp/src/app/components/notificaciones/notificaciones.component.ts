// src/app/components/notificaciones/notificaciones.component.ts
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { supabase } from '../../core/supabase.client';

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
export class NotificacionesComponent implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);

  // Estado
  cargando = signal(true);
  error = signal<string | null>(null);
  mensajeExito = signal<string | null>(null);

  // Datos
  notificaciones = signal<Notificacion[]>([]);

  // Computed
  userId = computed(() => this.auth.userId());
  esAdmin = computed(() => this.auth.getRol() === 'admin');

  noLeidas = computed(() => this.notificaciones().filter((n) => !n.leida).length);

  notificacionesAgrupadas = computed(() => {
    const todas = this.notificaciones();
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

  async eliminarNotificacion(notificacion: Notificacion, event: Event) {
    event.stopPropagation();

    try {
      const { error } = await supabase().from('notificaciones').delete().eq('id', notificacion.id);

      if (!error) {
        this.notificaciones.update((lista) => lista.filter((n) => n.id !== notificacion.id));
      }
    } catch (err) {
      console.error('Error eliminando:', err);
    }
  }

  async eliminarTodas() {
    if (!confirm('¿Eliminar todas las notificaciones?')) return;

    const uid = this.userId();
    if (!uid) return;

    try {
      const { error } = await supabase().from('notificaciones').delete().eq('usuario_id', uid);

      if (!error) {
        this.notificaciones.set([]);
        this.mensajeExito.set('Notificaciones eliminadas');
        setTimeout(() => this.mensajeExito.set(null), 3000);
      }
    } catch (err) {
      console.error('Error:', err);
    }
  }

  onClickNotificacion(notificacion: Notificacion) {
    this.marcarComoLeida(notificacion);

    if (notificacion.accion_url) {
      this.router.navigateByUrl(notificacion.accion_url);
    }
  }

  getIcono(tipo: string): string {
    switch (tipo) {
      case 'hueco_disponible':
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
      default:
        return 'notifications';
    }
  }

  getClaseTipo(tipo: string): string {
    switch (tipo) {
      case 'hueco_disponible':
        return 'tipo-disponible';
      case 'festivo':
        return 'tipo-festivo';
      case 'cancelacion':
        return 'tipo-cancelacion';
      case 'recuperacion':
        return 'tipo-recuperacion';
      default:
        return 'tipo-default';
    }
  }

  volver() {
    this.router.navigateByUrl('/dashboard');
  }

  trackById(_index: number, item: Notificacion): number {
    return item.id;
  }

  trackByTitulo(_index: number, grupo: { titulo: string }): string {
    return grupo.titulo;
  }
}
