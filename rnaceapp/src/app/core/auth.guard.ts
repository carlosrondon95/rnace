// src/app/core/auth.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.estaLogueado()) {
    return true;
  }

  // No hay sesión, redirigir a login
  router.navigateByUrl('/login');
  return false;
};

// Guard adicional para rutas de admin
export const adminGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.estaLogueado() && authService.getRol() === 'admin') {
    return true;
  }

  // No es admin, redirigir a dashboard
  router.navigateByUrl('/dashboard');
  return false;
};
