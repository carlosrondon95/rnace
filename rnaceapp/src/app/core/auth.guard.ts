// src/app/core/auth.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { supabase } from './supabase.client';

export const authGuard: CanActivateFn = async () => {
  const router = inject(Router);

  try {
    // Esperar a que Supabase verifique la sesión
    const {
      data: { session },
    } = await supabase().auth.getSession();

    if (session?.user) {
      return true;
    }

    // No hay sesión, redirigir a login
    router.navigateByUrl('/login');
    return false;
  } catch (error) {
    console.error('[AuthGuard] Error verificando sesión:', error);
    router.navigateByUrl('/login');
    return false;
  }
};
