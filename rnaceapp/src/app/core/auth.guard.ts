// src/app/core/auth.guard.ts
import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.estaLogueado()) {
    const usuario = auth.usuario();
    if (usuario && !usuario.activo) {
      await auth.logout();
      router.navigateByUrl('/login');
      return false;
    }
    return true;
  }

  router.navigateByUrl('/login');
  return false;
};

export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.estaLogueado()) {
    return true;
  }

  router.navigateByUrl('/dashboard');
  return false;
};

export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.getRol() === 'admin') {
    return true;
  }

  router.navigateByUrl('/dashboard');
  return false;
};

export const profesorGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const rol = auth.getRol();
  if (rol === 'profesor' || rol === 'admin') {
    return true;
  }

  router.navigateByUrl('/dashboard');
  return false;
};