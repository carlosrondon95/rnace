// src/app/core/audit.service.ts
import { Injectable, inject } from '@angular/core';
import { supabase } from './supabase.client';
import { AuthService } from './auth.service';

export type TipoCambio =
  | 'cambio_grupo'
  | 'cambio_horarios'
  | 'admin_add_sesion'
  | 'admin_cancel_reserva'
  | 'cliente_cancel_reserva'
  | 'cliente_usa_recuperacion'
  | 'admin_mueve_reserva'
  | 'cliente_cambio_turno';

@Injectable({ providedIn: 'root' })
export class AuditService {
  private auth = inject(AuthService);

  /**
   * Registra un cambio en la tabla registro_cambios.
   * Se ejecuta en background (fire-and-forget) para no bloquear la UX.
   */
  async registrarCambio(
    tipo: TipoCambio,
    usuarioId: string,
    usuarioNombre: string,
    descripcion: string,
    detalle?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const adminId = this.auth.userId();

      const { error } = await supabase()
        .from('registro_cambios')
        .insert({
          tipo,
          usuario_id: usuarioId,
          usuario_nombre: usuarioNombre,
          admin_id: adminId,
          descripcion,
          detalle: detalle ?? null,
        });

      if (error) {
        console.error('[Audit] Error registrando cambio:', error);
      }
    } catch (err) {
      console.error('[Audit] Error inesperado:', err);
    }
  }
}
