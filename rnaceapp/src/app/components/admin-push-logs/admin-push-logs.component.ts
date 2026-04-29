import { CommonModule, Location } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { supabase } from '../../core/supabase.client';

interface PushActivationLog {
  id: number;
  usuario_id: string | null;
  usuario_rol: string | null;
  event: string;
  level: 'info' | 'warn' | 'error';
  message: string | null;
  details: Record<string, any>;
  user_agent: string | null;
  created_at: string;
  usuarios?: {
    nombre: string | null;
    telefono: string | null;
    rol: string | null;
  } | null;
}

@Component({
  standalone: true,
  selector: 'app-admin-push-logs',
  imports: [CommonModule],
  templateUrl: './admin-push-logs.component.html',
  styleUrls: ['./admin-push-logs.component.scss'],
})
export class AdminPushLogsComponent implements OnInit {
  private location = inject(Location);

  logs = signal<PushActivationLog[]>([]);
  cargando = signal(false);
  error = signal<string | null>(null);
  filtro = signal<'todos' | 'errores'>('todos');

  ngOnInit(): void {
    this.cargarLogs();
  }

  async cargarLogs(): Promise<void> {
    const token = localStorage.getItem('rnace_token');
    if (!token) {
      this.error.set('No hay token de sesión. Cierra sesión y vuelve a entrar.');
      return;
    }

    this.cargando.set(true);
    this.error.set(null);

    try {
      const { data, error } = await supabase().functions.invoke('push-activation-log', {
        method: 'GET',
        headers: {
          'x-rnace-token': token,
        },
      });

      if (error) {
        this.error.set(await this.getFunctionErrorMessage(error));
        return;
      }

      if (!data?.success) {
        this.error.set(data?.error || 'No se pudieron cargar los logs');
        return;
      }

      this.logs.set(data.logs || []);
    } catch (err) {
      console.error('[PushLog] Error cargando logs:', err);
      this.error.set(await this.getFunctionErrorMessage(err));
    } finally {
      this.cargando.set(false);
    }
  }

  private async getFunctionErrorMessage(error: unknown): Promise<string> {
    const context = (error as { context?: Response })?.context;

    if (context) {
      try {
        const body = await context.clone().json();
        const message = body?.error || body?.message;

        if (message === 'Token invalido' || message === 'Token requerido') {
          return 'Sesión caducada. Cierra sesión y vuelve a entrar.';
        }

        if (message === 'Solo admin') {
          return 'Solo los administradores pueden ver estos logs.';
        }

        if (message) {
          return message;
        }
      } catch {
        // Si el body no es JSON, usamos el mensaje genérico de abajo.
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    return message || 'No se pudieron cargar los logs';
  }

  logsFiltrados(): PushActivationLog[] {
    if (this.filtro() === 'errores') {
      return this.logs().filter((log) => log.level === 'warn' || log.level === 'error');
    }

    return this.logs();
  }

  setFiltro(filtro: 'todos' | 'errores'): void {
    this.filtro.set(filtro);
  }

  volver(): void {
    this.location.back();
  }

  nombreUsuario(log: PushActivationLog): string {
    return log.usuarios?.nombre || log.usuarios?.telefono || log.usuario_id || 'Usuario desconocido';
  }

  formatoFecha(fecha: string): string {
    return new Date(fecha).toLocaleString('es-ES', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  getEstado(log: PushActivationLog): string {
    const details = log.details || {};
    const subscription = details['subscription_id'] ? 'subscription' : 'sin subscription';
    const permission = details['permission'] || 'sin permiso';
    return `${permission} · ${subscription}`;
  }

  getDevice(log: PushActivationLog): string {
    const ua = log.user_agent || '';
    if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
    if (/android/i.test(ua)) return 'Android';
    if (/windows/i.test(ua)) return 'Windows';
    if (/macintosh|mac os/i.test(ua)) return 'macOS';
    return 'Dispositivo';
  }

  trackById(_index: number, log: PushActivationLog): number {
    return log.id;
  }
}
