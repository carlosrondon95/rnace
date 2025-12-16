// src/app/app.routes.ts
import { Routes } from '@angular/router';
import { authGuard, adminGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },

  {
    path: 'login',
    loadComponent: () => import('./auth/login/login.component').then((m) => m.LoginComponent),
  },

  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./components/dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },

  {
    path: 'reservar-cita',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./components/reservas/reserva-cita.component').then((m) => m.ReservaCitaComponent),
  },

  {
    path: 'calendario',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./components/calendario/calendario.component').then((m) => m.CalendarioComponent),
  },

  {
    path: 'gestionar-perfiles',
    canActivate: [authGuard, adminGuard],
    loadComponent: () =>
      import('./components/gestionar-perfiles/gestionar-perfiles.component').then(
        (m) => m.GestionarPerfilesComponent,
      ),
  },

  {
    path: 'admin-reservas',
    canActivate: [authGuard, adminGuard],
    loadComponent: () =>
      import('./components/admin-reservas/admin-reservas.component').then(
        (m) => m.AdminReservasComponent,
      ),
  },

  { path: '**', redirectTo: 'login' },
];
