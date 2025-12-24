// src/app/components/admin-avisos/admin-avisos.component.ts
import { Component, inject, signal } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
        <button class="btn-volver" (click)="volver()">
          <span class="material-symbols-rounded">arrow_back</span>
          Notificaciones
        </button>
        <h1>Enviar Aviso</h1>
      </header>

      <section class="form-container">


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
            <label>Destinatarios</label>
            <div class="group-selector">
              <label class="radio-label group-all">
                <input type="radio" name="grupoObjetivo" [value]="'todos'" [ngModel]="grupoObjetivo()" (ngModelChange)="grupoObjetivo.set($event)">
                <span class="radio-custom"></span>
                <span class="radio-text">
                  <strong>Todos</strong>
                  <small>Todos los usuarios activos</small>
                </span>
              </label>
              
              <label class="radio-label group-focus">
                <input type="radio" name="grupoObjetivo" [value]="'focus'" [ngModel]="grupoObjetivo()" (ngModelChange)="grupoObjetivo.set($event)">
                <span class="radio-custom"></span>
                <span class="radio-text">
                  <strong>Grupo Focus</strong>
                  <small>Incluye usuarios Híbridos</small>
                </span>
              </label>
              
              <label class="radio-label group-reducido">
                <input type="radio" name="grupoObjetivo" [value]="'reducido'" [ngModel]="grupoObjetivo()" (ngModelChange)="grupoObjetivo.set($event)">
                <span class="radio-custom"></span>
                <span class="radio-text">
                  <strong>Grupo Reducido</strong>
                  <small>Incluye usuarios Híbridos</small>
                </span>
              </label>
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
              Enviar
            }
          </button>
        </form>
      </section>
    </main>
  `,
  styleUrl: './admin-avisos.component.scss'
})
export class AdminAvisosComponent {
  private location = inject(Location);
  auth = inject(AuthService);
  private confirmation = inject(ConfirmationService);

  // Form Data
  titulo = signal('');
  mensaje = signal('');
  tipo = signal<'admin_info' | 'admin_warning' | 'admin_urgent' | 'admin_promo'>('admin_info');
  grupoObjetivo = signal<'todos' | 'focus' | 'reducido'>('todos');

  // State
  enviando = signal(false);
  error = signal<string | null>(null);
  success = signal<string | null>(null);

  volver() {
    this.location.back();
  }

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

  getNombreGrupo(grupo: string): string {
    switch (grupo) {
      case 'todos': return 'TODOS los usuarios';
      case 'focus': return 'Grupo FOCUS (+ Híbridos)';
      case 'reducido': return 'Grupo REDUCIDO (+ Híbridos)';
      default: return grupo;
    }
  }

  esValido(): boolean {
    return this.titulo().trim().length > 3 && this.mensaje().trim().length > 5;
  }

  async enviarAviso() {
    if (!await this.confirmation.confirm({
      titulo: 'Enviar aviso general',
      mensaje: `¿Estás seguro de enviar este aviso a: ${this.getNombreGrupo(this.grupoObjetivo())}?`,
      tipo: 'warning',
      textoConfirmar: 'Enviar aviso'
    })) return;

    this.enviando.set(true);
    this.error.set(null);
    this.success.set(null);

    try {
      // Usamos la nueva función filtrada
      const { data, error } = await supabase().rpc('enviar_aviso_filtrado', {
        p_usuario_id: this.auth.userId(),
        p_titulo: this.titulo(),
        p_mensaje: this.mensaje(),
        p_tipo: this.tipo(),
        p_grupo_objetivo: this.grupoObjetivo()
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
