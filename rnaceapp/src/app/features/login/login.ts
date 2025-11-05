import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  standalone: true,
  selector: 'app-login',
  imports: [NgIf, FormsModule],
  template: `
  <section class="max-w-sm mx-auto p-6 space-y-4">
    <h2 class="text-2xl font-semibold text-center">Acceso</h2>

    <div class="space-y-2">
      <input class="w-full border rounded-lg p-2" type="email" placeholder="Email" [(ngModel)]="email">
      <input class="w-full border rounded-lg p-2" type="password" placeholder="Contraseña" [(ngModel)]="password">
    </div>

    <button class="w-full rounded-lg p-2 bg-brand-500 text-white hover:opacity-90"
            (click)="login()">Entrar</button>

    <p class="text-sm text-center text-gray-600" *ngIf="error()">{{ error() }}</p>
  </section>
  `,
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  email = '';
  password = '';
  error = signal<string | null>(null);

  async login() {
    this.error.set(null);
    try {
      await this.auth.signInWithPassword(this.email, this.password);
      this.router.navigateByUrl('/dashboard');
    } catch (e: unknown) {
      const mensaje =
        e instanceof Error ? e.message : typeof e === 'string' ? e : 'Error de acceso';
      this.error.set(mensaje);
    }
  }
}
