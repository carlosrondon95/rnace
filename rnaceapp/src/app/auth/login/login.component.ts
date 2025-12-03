// src/app/auth/login/login.component.ts
import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { supabase } from '../../core/supabase.client';

@Component({
  standalone: true,
  selector: 'app-login',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private router = inject(Router);

  loading = signal(false);
  errorMsg = signal<string | null>(null);

  form = this.fb.group({
    telefono: ['', [Validators.required, Validators.pattern(/^[0-9]{9,15}$/)]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  /**
   * Convierte un teléfono a formato email para auth
   * Ejemplo: 663734173 → 663734173@rnace.local
   */
  private telefonoToEmail(telefono: string): string {
    // Limpiar: solo números
    const soloNumeros = telefono.replace(/[^0-9]/g, '');
    return `${soloNumeros}@rnace.local`;
  }

  async onSubmit() {
    this.errorMsg.set(null);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);

    const telefono = this.form.value.telefono!.trim();
    const password = this.form.value.password!;

    // Convertir teléfono a email falso
    const emailFalso = this.telefonoToEmail(telefono);
    console.log('[Login] Teléfono:', telefono, '→ Email:', emailFalso);

    try {
      const client = supabase();

      // Login con email (que en realidad es el teléfono disfrazado)
      const { data, error } = await client.auth.signInWithPassword({
        email: emailFalso,
        password: password,
      });

      if (error) {
        console.error('[Supabase auth error]', error);

        if (error.message.includes('Invalid login credentials')) {
          this.errorMsg.set('Teléfono o contraseña incorrectos.');
        } else {
          this.errorMsg.set('Error al iniciar sesión. Verifica tus datos.');
        }
        return;
      }

      if (!data.session) {
        this.errorMsg.set('No se ha podido iniciar sesión.');
        return;
      }

      this.router.navigateByUrl('/dashboard');
    } catch (e) {
      console.error(e);
      this.errorMsg.set('Error inesperado al iniciar sesión.');
    } finally {
      this.loading.set(false);
    }
  }

  showFieldError(field: 'telefono' | 'password'): boolean {
    const c = this.form.get(field);
    return !!c && c.invalid && (c.dirty || c.touched);
  }

  getFieldErrorMessage(field: 'telefono' | 'password'): string {
    const c = this.form.get(field);
    if (!c) return '';

    if (field === 'telefono') {
      if (c.hasError('required')) return 'Introduce tu número de teléfono.';
      if (c.hasError('pattern')) return 'Introduce solo números (9-15 dígitos).';
    }

    if (field === 'password') {
      if (c.hasError('required')) return 'Introduce tu contraseña.';
      if (c.hasError('minlength')) return 'Mínimo 6 caracteres.';
    }

    return '';
  }
}
