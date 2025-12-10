// src/app/components/dashboard/dashboard.component.ts
import { CommonModule } from '@angular/common';
import { Component, signal, inject, computed } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';

@Component({
  standalone: true,
  selector: 'app-dashboard',
  imports: [CommonModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent {
  private router = inject(Router);
  private authService = inject(AuthService);

  showLoginSplash = signal(true);

  // Datos del usuario desde AuthService
  usuario = computed(() => this.authService.usuario());
  nombre = computed(() => this.usuario()?.nombre || 'Usuario');
  role = computed(() => this.usuario()?.rol || 'cliente');

  constructor() {
    // Ocultar splash después de 1.5 segundos
    setTimeout(() => this.showLoginSplash.set(false), 1500);
  }

  // Handlers de navegación
  onReservaCita() {
    this.router.navigateByUrl('/reservar-cita');
  }

  onVerCalendario() {
    console.log('Ver calendario');
  }

  onPerfil() {
    console.log('Mi perfil');
  }

  onMisGrupos() {
    console.log('Mis grupos');
  }

  onVerCitas() {
    console.log('Ver citas');
  }

  onVerGrupos() {
    console.log('Ver grupos');
  }

  onGestionarPerfiles() {
    this.router.navigateByUrl('/gestionar-perfiles');
  }

  onLogout() {
    this.authService.logout();
    this.router.navigateByUrl('/login');
  }
}
