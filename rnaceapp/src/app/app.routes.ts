// src/app/app.routes.ts
import { Routes } from '@angular/router';
import { authGuard, guestGuard, adminGuard } from './core/auth.guard';

export const routes: Routes = [
  // Ruta por defecto
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full',
  },

  // Login (solo para no autenticados)
  {
    path: 'login',
    loadComponent: () =>
      import('./auth/login/login.component').then((m) => m.LoginComponent),
    canActivate: [guestGuard],
  },

  // Dashboard (autenticados)
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./components/dashboard/dashboard.component').then((m) => m.DashboardComponent),
    canActivate: [authGuard],
  },

  // Calendario / Mis clases (autenticados)
  {
    path: 'calendario',
    loadComponent: () =>
      import('./components/calendario/calendario.component').then((m) => m.CalendarioComponent),
    canActivate: [authGuard],
  },

  // Recuperar clase (clientes - antes era reservar-cita)
  {
    path: 'recuperar-clase',
    loadComponent: () =>
      import('./components/reservas/reserva-cita.component').then((m) => m.ReservaCitaComponent),
    canActivate: [authGuard],
  },

  // Alias antiguo por compatibilidad
  {
    path: 'reservar-cita',
    redirectTo: 'recuperar-clase',
    pathMatch: 'full',
  },

  // Notificaciones (autenticados)
  {
    path: 'notificaciones',
    loadComponent: () =>
      import('./components/notificaciones/notificaciones.component').then(
        (m) => m.NotificacionesComponent,
      ),
    canActivate: [authGuard],
  },

  // === RUTAS ADMIN ===

  // Gestionar perfiles (admin)
  {
    path: 'gestionar-perfiles',
    loadComponent: () =>
      import('./components/gestionar-perfiles/gestionar-perfiles.component').then(
        (m) => m.GestionarPerfilesComponent,
      ),
    canActivate: [authGuard, adminGuard],
  },

  // Admin reservas (admin)
  {
    path: 'admin-reservas',
    loadComponent: () =>
      import('./components/admin-reservas/admin-reservas.component').then(
        (m) => m.AdminReservasComponent,
      ),
    canActivate: [authGuard, adminGuard],
  },

  // Lista de espera (admin)
  {
    path: 'lista-espera',
    loadComponent: () =>
      import('./components/lista-espera/lista-espera.component').then(
        (m) => m.ListaEsperaComponent,
      ),
    canActivate: [authGuard, adminGuard],
  },

  // Ruta catch-all
  {
    path: '**',
    redirectTo: 'dashboard',
  },
];