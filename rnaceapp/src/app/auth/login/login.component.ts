// src/app/auth/login/login.component.ts
import { Component, signal, inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';

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

  constructor() {
    // Si ya está logueado en la app, ir al dashboard
    if (this.authService.estaLogueado()) {
      this.router.navigateByUrl('/dashboard');
    } else if (isPlatformBrowser(this.platformId)) {
      // Limpieza preventiva de sesiones caducadas de Supabase
      // Esto soluciona problemas de login tras mucho tiempo inactivo
      localStorage.removeItem('sb-bpzdpsmwtsmwrlyxzcsk-auth-token');
    }
  }

  async onSubmit() {
    this.error.set(null);

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
