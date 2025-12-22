// src/app/components/admin-avisos/admin-avisos.component.ts
import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ConfirmationService } from '../../shared/confirmation-modal/confirmation.service';
import { supabase } from '../../core/supabase.client';

@Component({
  standalone: true,
  selector: 'app-admin-avisos',
  imports: [CommonModule, FormsModule],
  template: `
    <main class="page-container">
      <header class="page-header">
        <button class="btn-back" (click)="router.navigateByUrl('/dashboard')">
          <span class="material-symbols-rounded">arrow_back</span>
        </button>
        <h1>Enviar Aviso General</h1>
      </header>

      <section class="form-container">
        <!-- Preview Card -->
        <div class="preview-card" [ngClass]="getClaseTipo(tipo())">
            <div class="preview-icon">
                <span class="material-symbols-rounded">{{ getIcono(tipo()) }}</span>
            </div>
            <div class="preview-content">
                <h3>{{ titulo() || 'Título del aviso' }}</h3>
                <p>{{ mensaje() || 'El mensaje aparecerá aquí...' }}</p>
            </div>
            <span class="preview-badge">Vista Previa</span>
        </div>

        <form (ngSubmit)="enviarAviso()">
          <div class="form-group">
            <label>Tipo de Aviso</label>
            <div class="type-selector">
              <button type="button" 
                [class.active]="tipo() === 'admin_info'"
                (click)="tipo.set('admin_info')"
                class="type-btn type-info">
                <span class="material-symbols-rounded">info</span>
                Info
              </button>
              <button type="button" 
                [class.active]="tipo() === 'admin_warning'"
                (click)="tipo.set('admin_warning')"
                class="type-btn type-warning">
                <span class="material-symbols-rounded">warning</span>
                Importante
              </button>
              <button type="button" 
                [class.active]="tipo() === 'admin_urgent'"
                (click)="tipo.set('admin_urgent')"
                class="type-btn type-urgent">
                <span class="material-symbols-rounded">report</span>
                Urgente
              </button>
              <button type="button" 
                [class.active]="tipo() === 'admin_promo'"
                (click)="tipo.set('admin_promo')"
                class="type-btn type-promo">
                <span class="material-symbols-rounded">celebration</span>
                Promo
              </button>
            </div>
          </div>

          <div class="form-group">
            <label for="titulo">Título</label>
            <input 
              id="titulo" 
              type="text" 
              [(ngModel)]="titulo" 
              name="titulo" 
              placeholder="Ej: Mantenimiento programado"
              required
              maxlength="50"
            >
          </div>

          <div class="form-group">
            <label for="mensaje">Mensaje</label>
            <textarea 
              id="mensaje" 
              [(ngModel)]="mensaje" 
              name="mensaje" 
              placeholder="Escribe el contenido del mensaje..."
              rows="4"
              required
              maxlength="200"
            ></textarea>
            <div class="char-count">{{ mensaje().length }}/200</div>
          </div>

          @if (error()) {
            <div class="error-msg">
              <span class="material-symbols-rounded">error</span>
              {{ error() }}
            </div>
          }

          @if (success()) {
            <div class="success-msg">
              <span class="material-symbols-rounded">check_circle</span>
              {{ success() }}
            </div>
          }

          <button type="submit" class="btn-submit" [disabled]="enviando() || !esValido()">
            @if (enviando()) {
              <span class="spinner"></span>
              Enviando...
            } @else {
              <span class="material-symbols-rounded">send</span>
              Enviar a todos los usuarios
            }
          </button>
        </form>
      </section>
    </main>
  `,
  styleUrl: './admin-avisos.component.scss'
})
export class AdminAvisosComponent {
  router = inject(Router);
  auth = inject(AuthService);
  private confirmation = inject(ConfirmationService);
  
  // Form Data
  titulo = signal('');
  mensaje = signal('');
  tipo = signal<'admin_info' | 'admin_warning' | 'admin_urgent' | 'admin_promo'>('admin_info');
  
  // State
  enviando = signal(false);
  error = signal<string | null>(null);
  success = signal<string | null>(null);

  getIcono(tipo: string): string {
    switch (tipo) {
      case 'admin_info': return 'info';
      case 'admin_warning': return 'warning';
      case 'admin_urgent': return 'report';
      case 'admin_promo': return 'celebration';
      default: return 'notifications';
    }
  }

  getClaseTipo(tipo: string): string {
    return tipo; 
  }

  esValido(): boolean {
    return this.titulo().trim().length > 3 && this.mensaje().trim().length > 5;
  }

  async enviarAviso() {
    if (!await this.confirmation.confirm({
      titulo: 'Enviar aviso general',
      mensaje: '¿Estás seguro de enviar esta notificación a TODOS los usuarios?',
      tipo: 'warning',
      textoConfirmar: 'Enviar a todos'
    })) return;

    this.enviando.set(true);
    this.error.set(null);
    this.success.set(null);

    try {
      const { data, error } = await supabase().rpc('enviar_aviso_general', {
        p_usuario_id: this.auth.userId(),
        p_titulo: this.titulo(),
        p_mensaje: this.mensaje(),
        p_tipo: this.tipo()
      });

      if (error) throw error;

      if (data && data[0]?.ok) {
        this.success.set('¡Aviso enviado correctamente a todos los usuarios!');
        this.titulo.set('');
        this.mensaje.set('');
        setTimeout(() => this.success.set(null), 5000);
      } else {
        throw new Error(data?.[0]?.mensaje || 'Error desconocido');
      }

    } catch (err: any) {
      console.error('Error enviando aviso:', err);
      this.error.set(err.message || 'Error al enviar el aviso');
    } finally {
      this.enviando.set(false);
    }
  }
}
