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
    identifier: ['', [Validators.required]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  async onSubmit() {
    this.errorMsg.set(null);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);

    const identifier = this.form.value.identifier!.trim();
    const password = this.form.value.password!;
    const isEmail = identifier.includes('@');

    try {
      const client = supabase();

      const { data, error } = await client.auth.signInWithPassword(
        isEmail ? { email: identifier, password } : { phone: identifier, password },
      );

      if (error) {
        console.error('[Supabase auth error]', error);
        this.errorMsg.set(error.message || 'Credenciales no válidas.');
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

  showFieldError(field: 'identifier' | 'password'): boolean {
    const c = this.form.get(field);
    return !!c && c.invalid && (c.dirty || c.touched);
  }
}
