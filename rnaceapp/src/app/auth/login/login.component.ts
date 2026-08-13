// src/app/auth/login/login.component.ts
import { Component, signal, inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { MotivoFinSesion, SESSION_END_REASON_KEY } from '../../core/session-token';

@Component({
  standalone: true,
  selector: 'app-login',
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent {
  private router = inject(Router);
  private authService = inject(AuthService);
  private platformId = inject(PLATFORM_ID);

  telefono = signal('');
  password = signal('');
  cargando = signal(false);
  error = signal<string | null>(null);
  aviso = signal<string | null>(null);

  constructor() {
    // Si ya está logueado en la app, ir al dashboard
    if (this.authService.estaLogueado()) {
      this.router.navigateByUrl('/dashboard');
    } else if (isPlatformBrowser(this.platformId)) {
      // Limpieza preventiva de sesiones caducadas de Supabase
      // Esto soluciona problemas de login tras mucho tiempo inactivo
      localStorage.removeItem('sb-bpzdpsmwtsmwrlyxzcsk-auth-token');

      this.mostrarMotivoDeCierre();
    }
  }

  /**
   * Si la sesión se cerró sola, explicar por qué. Antes se expulsaba al usuario
   * a esta pantalla sin ninguna indicación, que es literalmente la queja que
   * llegaba del centro ("se les cierra sin saberlo").
   */
  private mostrarMotivoDeCierre() {
    const motivo = localStorage.getItem(SESSION_END_REASON_KEY) as MotivoFinSesion | null;
    if (!motivo) return;

    // Se consume una sola vez: si no, reaparecería en cada visita a /login.
    localStorage.removeItem(SESSION_END_REASON_KEY);

    if (motivo === 'desactivada') {
      this.aviso.set('Tu cuenta está desactivada. Contacta con el centro.');
    } else {
      this.aviso.set('Tu sesión ha caducado. Vuelve a entrar para continuar.');
    }
  }

  async onSubmit() {
    this.error.set(null);
    this.aviso.set(null);

    const tel = this.telefono().trim();
    const pass = this.password();

    if (!tel) {
      this.error.set('Introduce tu número de teléfono');
      return;
    }

    if (!pass) {
      this.error.set('Introduce tu contraseña');
      return;
    }

    this.cargando.set(true);

    try {
      console.log('[Login] Intentando login con:', tel);

      const resultado = await this.authService.login(tel, pass);

      if (resultado.success) {
        console.log('[Login] Éxito, navegando a dashboard');
        this.router.navigateByUrl('/dashboard');
      } else {
        console.log('[Login] Error:', resultado.error);
        this.error.set(resultado.error || 'Error al iniciar sesión');
      }
    } catch (err) {
      console.error('[Login] Error inesperado:', err);
      this.error.set('Error inesperado. Intenta de nuevo.');
    } finally {
      this.cargando.set(false);
    }
  }

  actualizarTelefono(valor: string) {
    // Solo permitir números
    const soloNumeros = valor.replace(/[^0-9]/g, '');
    this.telefono.set(soloNumeros);
  }

  actualizarPassword(valor: string) {
    this.password.set(valor);
  }
}
