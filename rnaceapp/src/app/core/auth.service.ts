// src/app/core/auth.service.ts
import { Injectable, signal, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { supabase } from './supabase.client';
import { PushNotificationService } from './push-notification.service';

export interface Usuario {
  id: string;
  telefono: string;
  nombre: string | null;
  rol: 'cliente' | 'profesor' | 'admin';
  activo: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private platformId = inject(PLATFORM_ID);
  private pushService = inject(PushNotificationService);
  private usuarioActual = signal<Usuario | null>(null);

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.cargarUsuarioGuardado();
      this.recuperarSesion();
    }
  }

  get usuario() {
    return this.usuarioActual;
  }

  estaLogueado(): boolean {
    return this.usuarioActual() !== null;
  }

  getRol(): string {
    return this.usuarioActual()?.rol || 'cliente';
  }

  userId = () => this.usuarioActual()?.id || null;

  private async recuperarSesion() {
    // Check if we have a valid Supabase session
    const { data: { session } } = await supabase().auth.getSession();
    if (session) {
      // Optionally refresh user data
      // console.log('Sesión activa:', session.user.id);
    }
  }

  private cargarUsuarioGuardado() {
    if (!isPlatformBrowser(this.platformId)) return;

    try {
      const guardado = localStorage.getItem('rnace_usuario');
      if (guardado) {
        const usuario = JSON.parse(guardado) as Usuario;
        this.usuarioActual.set(usuario);
      }
    } catch (error) {
      console.error('Error cargando usuario guardado:', error);
      localStorage.removeItem('rnace_usuario');
    }
  }

  private guardarUsuario(usuario: Usuario) {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('rnace_usuario', JSON.stringify(usuario));
    }
    this.usuarioActual.set(usuario);
  }

  async login(telefono: string, password: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!telefono || !password) {
        return { success: false, error: 'Datos incompletos' };
      }

      // Call Secure Edge Function
      const { data, error } = await supabase().functions.invoke('login', {
        body: { telefono, password }
      });

      if (error) {
        // HTTP Error (400, 401, 500)
        try {
          // Try to parse error body if it's a string, otherwise it's unknown
          const errBody = JSON.parse(await error.context.json());
          return { success: false, error: errBody.error || 'Error al iniciar sesión' };
        } catch {
          return { success: false, error: 'Error de conexión o credenciales inválidas' };
        }
      }

      if (!data.success) {
        return { success: false, error: data.error || 'Error al iniciar sesión' };
      }

      // CRITICAL: Set the session in Supabase Client
      const { error: sessionError } = await supabase().auth.setSession({
        access_token: data.access_token,
        refresh_token: data.access_token // We are not implementing refresh token rotation yet, simpler for now
      });

      if (sessionError) {
        console.error('Error estableciendo sesión:', sessionError);
        return { success: false, error: 'Error estableciendo sesión segura' };
      }

      const usuarioLimpio: Usuario = {
        id: data.user.id,
        telefono: data.user.telefono,
        nombre: data.user.nombre,
        rol: data.user.rol,
        activo: true,
      };

      this.guardarUsuario(usuarioLimpio);
      return { success: true };

    } catch (error) {
      console.error('Error en login:', error);
      return { success: false, error: 'Error inesperado' };
    }
  }

  async logout() {
    // Eliminar token FCM antes de cerrar sesión
    await this.pushService.removeToken();

    // Close secure session
    await supabase().auth.signOut();

    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('rnace_usuario');
    }
    this.usuarioActual.set(null);
  }

  // Crear usuario básico (solo datos de autenticación)
  async crearUsuario(datos: {
    telefono: string;
    password: string;
    nombre: string;
    rol?: string;
  }): Promise<{ success: boolean; error?: string; userId?: string }> {
    try {
      if (this.getRol() !== 'admin') {
        return { success: false, error: 'Solo los administradores pueden crear usuarios' };
      }

      const telefonoLimpio = datos.telefono.replace(/[^0-9]/g, '');

      // TODO: Move this to server-side logic in next step
      // For now, we will hash loosely on client if needed OR better:
      // Call a new 'admin-create-user' function. 
      // BUT for immediate fix to lint errors:
      // We accept that we cannot securely create users on client anymore.

      return { success: false, error: 'La creación de usuarios requiere migración a función de servidor.' };

    } catch (error) {
      console.error('Error:', error);
      return { success: false, error: 'Error inesperado al crear usuario' };
    }
  }

  // Eliminar usuario (solo admin)
  async eliminarUsuario(userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.getRol() !== 'admin') {
        return { success: false, error: 'Solo los administradores pueden eliminar usuarios' };
      }

      if (this.userId() === userId) {
        return { success: false, error: 'No puedes eliminar tu propia cuenta' };
      }

      const { error } = await supabase().from('usuarios').delete().eq('id', userId);

      if (error) {
        console.error('Error eliminando usuario:', error);
        return { success: false, error: 'Error al eliminar: ' + error.message };
      }

      return { success: true };
    } catch (error) {
      console.error('Error:', error);
      return { success: false, error: 'Error inesperado' };
    }
  }

  async cambiarPassword(
    telefonoOId: string,
    nuevaPassword: string,
  ): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Cambio de contraseña requiere migración a función de servidor.' };
  }
}