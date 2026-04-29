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
  push_subscription?: PushSubscriptionSummary | null;
  usuarios?: {
    nombre: string | null;
    telefono: string | null;
    rol: string | null;
  } | null;
}

interface PushSubscriptionSummary {
  source: 'onesignal' | 'database' | 'none';
  count: number;
  active_count: number;
  latest_subscription_id: string | null;
  latest_onesignal_id: string | null;
  external_id: string | null;
  last_seen_at: string | null;
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

  exportarJson(): void {
    const logs = this.logsFiltrados();

    if (logs.length === 0) {
      this.error.set('No hay logs para exportar con el filtro actual.');
      return;
    }

    this.error.set(null);

    const exportedAt = new Date();
    const payload = {
      exported_at: exportedAt.toISOString(),
      filter: this.filtro(),
      count: logs.length,
      logs,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = `rnace-push-logs-${this.filtro()}-${this.formatFileDate(exportedAt)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  private formatFileDate(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
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
    const permission = details['permission'] || 'sin permiso';
    const subscription = this.getSubscriptionStatus(log);
    return `${permission} · ${subscription}`;
  }

  getSubscriptionStatus(log: PushActivationLog): string {
    const subscription = log.push_subscription;
    const source = subscription?.source;
    const count = subscription?.active_count || subscription?.count || 0;

    if (count > 0) {
      const label = count === 1 ? '1 subscription' : `${count} subscriptions`;
      const sourceLabel = source === 'onesignal' ? 'OneSignal' : 'BD';
      return `${label} ${sourceLabel}`;
    }

    if (this.getSubscriptionId(log)) {
      return 'subscription local';
    }

    return 'sin subscription detectada';
  }

  getOneSignalId(log: PushActivationLog): string | null {
    return this.asText(log.push_subscription?.latest_onesignal_id || log.details?.['onesignal_id']);
  }

  getExternalId(log: PushActivationLog): string | null {
    return this.asText(log.push_subscription?.external_id || log.details?.['external_id']);
  }

  getSubscriptionId(log: PushActivationLog): string | null {
    return this.asText(
      log.push_subscription?.latest_subscription_id || log.details?.['subscription_id'],
    );
  }

  getSubscriptionExtra(log: PushActivationLog): string | null {
    const count = log.push_subscription?.active_count || log.push_subscription?.count || 0;
    return count > 1 ? `+${count - 1}` : null;
  }

  hasTechnicalIds(log: PushActivationLog): boolean {
    return Boolean(this.getOneSignalId(log) || this.getExternalId(log) || this.getSubscriptionId(log));
  }

  private asText(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
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
