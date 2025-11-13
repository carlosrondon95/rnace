// src/app/dashboard/dashboard.component.ts
import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';

@Component({
  standalone: true,
  selector: 'app-dashboard',
  imports: [CommonModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent {
  // Splash de éxito al entrar (logo + cargando 2s)
  showLoginSplash = signal(true);

  constructor() {
    setTimeout(() => {
      this.showLoginSplash.set(false);
    }, 2000);
  }

  onReservaCita() {
    console.log('Reserva tu cita (pendiente de implementar navegación)');
  }

  onVerCalendario() {
    console.log('Ver calendario (pendiente de implementar navegación)');
  }

  onPerfil() {
    console.log('Perfil (pendiente de implementar navegación)');
  }
}
