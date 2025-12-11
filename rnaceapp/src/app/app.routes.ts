// src/app/app.routes.ts
import { Routes } from '@angular/router';
import { authGuard, adminGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },

  // Login
  {
    path: 'login',
    loadComponent: () => import('./auth/login/login.component').then((m) => m.LoginComponent),
  },

  // Dashboard (protegido)
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./components/dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },

  // Reservar cita (protegido, cliente)
  {
    path: 'reservar-cita',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./components/reservas/reserva-cita.component').then((m) => m.ReservaCitaComponent),
  },

  // Calendario (protegido, todos los usuarios)
  {
    path: 'calendario',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./components/calendario/calendario.component').then((m) => m.CalendarioComponent),
  },

  // Gestionar perfiles (protegido, solo admin)
  {
    path: 'gestionar-perfiles',
    canActivate: [authGuard, adminGuard],
    loadComponent: () =>
      import('./components/gestionar-perfiles/gestionar-perfiles.component').then(
        (m) => m.GestionarPerfilesComponent,
      ),
  },

  { path: '**', redirectTo: 'login' },
];
