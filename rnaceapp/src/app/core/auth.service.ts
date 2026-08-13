// src/app/core/auth.service.ts
import { Injectable, signal, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { supabase } from './supabase.client';
import { PushNotificationService } from './push-notification.service';
import {
  MotivoFinSesion,
  SESSION_END_REASON_KEY,
  SESSION_LAST_REFRESH_KEY,
  SESSION_TOKEN_KEY,
  SESSION_USER_KEY,
  leerToken,
  leerTokenValido,
  tokenCaducado,
} from './session-token';

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
  private router = inject(Router);
  private usuarioActual = signal<Usuario | null>(null);

  /**
   * Al volver a la app renovamos como mucho una vez cada 12 h. El arranque
   * (recarga / abrir la PWA) sí renueva siempre: es el punto donde queremos que
   * se apliquen las bajas y los cambios de rol que haya hecho el admin.
   */
  private readonly throttleRenovacionMs = 12 * 60 * 60 * 1000;
  private renovacionEnCurso: Promise<void> | null = null;
  private listenersCicloListos = false;

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.cargarUsuarioGuardado();
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

  private cargarUsuarioGuardado() {
    if (!isPlatformBrowser(this.platformId)) return;

    try {
      const guardado = localStorage.getItem(SESSION_USER_KEY);
      const token = leerToken();

      // Si falta el token o el usuario, no hay sesión válida que restaurar.
      if (!guardado || !token) {
        this.limpiarSesionLocal();
        return;
      }

      // Comprobar caducidad del JWT antes de marcar al usuario como logueado.
      // No validamos la firma aquí (eso lo hace el backend); solo el campo
      // `exp` para no arrastrar sesiones caducadas que fallarían en cada
      // request al servidor.
      if (tokenCaducado(token)) {
        this.limpiarSesionLocal('caducada');
        return;
      }

      const usuario = JSON.parse(guardado) as Usuario;
      this.usuarioActual.set(usuario);
      this.registrarListenersDeCiclo();

      // Renovar en segundo plano: es lo que hace que la sesión no se cierre
      // sola. No bloquea el arranque de la app.
      void this.renovarSesion();
      void this.sincronizarPushSiHayUsuario();
    } catch (error) {
      console.error('Error cargando usuario guardado:', error);
      this.limpiarSesionLocal();
    }
  }

  /**
   * Renueva el access token contra la Edge Function `refresh-session`.
   *
   * Regla de oro: la sesión SOLO se cierra ante un rechazo confirmado del
   * servidor (401). Ante un fallo de red, un timeout o un 5xx se conserva el
   * token actual y se reintentará más tarde — si no, un cliente sin cobertura
   * quedaría expulsado, que es justo el problema que venimos a arreglar.
   *
   * @param opciones.respetarThrottle limita a una renovación cada 12 h. Se usa
   *   al volver a la app (puede dispararse muchas veces por sesión); el arranque
   *   renueva siempre.
   */
  async renovarSesion(opciones?: { respetarThrottle?: boolean }): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    if (!this.estaLogueado()) return;

    const token = leerTokenValido();
    if (!token) return; // Sin token vigente no hay nada que renovar.

    if (opciones?.respetarThrottle && !this.tocaRenovarPorTiempo()) return;

    // Evitar renovaciones solapadas (arranque + focus casi simultáneos).
    if (this.renovacionEnCurso) return this.renovacionEnCurso;

    this.renovacionEnCurso = (async () => {
      try {
        const { data, error } = await supabase().functions.invoke('refresh-session', {
          headers: { 'x-rnace-token': token },
        });

        if (error) {
          const status = (error as { context?: Response }).context?.status;

          // 401 = el servidor ha rechazado la sesión de forma explícita.
          if (status === 401) {
            await this.cerrarSesionPorRechazo(error);
            return;
          }

          // Cualquier otra cosa (red, timeout, 5xx): conservamos la sesión.
          console.warn('[Auth] No se pudo renovar la sesión, se conserva la actual:', error.message);
          return;
        }

        if (!data?.success || !data?.access_token) {
          console.warn('[Auth] Respuesta inesperada al renovar; se conserva la sesión actual');
          return;
        }

        localStorage.setItem(SESSION_TOKEN_KEY, data.access_token);
        localStorage.setItem(SESSION_LAST_REFRESH_KEY, String(Date.now()));

        // El rol y el nombre se releen del servidor en cada renovación, así que
        // dejan de quedarse congelados desde el login.
        if (data.user) {
          this.guardarUsuario({
            id: data.user.id,
            telefono: data.user.telefono,
            nombre: data.user.nombre,
            rol: data.user.rol,
            activo: true,
          });
        }

        // Reafirmar el vínculo del dispositivo con el token nuevo.
        void this.sincronizarPushSiHayUsuario();
      } catch (error) {
        console.warn('[Auth] Error inesperado renovando; se conserva la sesión actual:', error);
      } finally {
        this.renovacionEnCurso = null;
      }
    })();

    return this.renovacionEnCurso;
  }

  private tocaRenovarPorTiempo(): boolean {
    try {
      const ultimo = Number(localStorage.getItem(SESSION_LAST_REFRESH_KEY) || 0);
      if (!Number.isFinite(ultimo) || ultimo <= 0) return true;
      return Date.now() - ultimo >= this.throttleRenovacionMs;
    } catch {
      return true;
    }
  }

  /** Traduce el 401 de `refresh-session` en un motivo y cierra la sesión. */
  private async cerrarSesionPorRechazo(error: unknown): Promise<void> {
    let motivo: MotivoFinSesion = 'caducada';

    try {
      const body = await (error as { context: Response }).context.json();
      if (body?.error === 'Cuenta desactivada' || body?.error === 'Cuenta no encontrada') {
        motivo = 'desactivada';
      }
    } catch {
      // Cuerpo ilegible: lo tratamos como caducidad, que es el caso habitual.
    }

    console.warn('[Auth] Sesión rechazada por el servidor:', motivo);
    await this.logout(motivo);
    void this.router.navigateByUrl('/login');
  }

  /**
   * Al volver a la app: comprobar que la sesión sigue viva y renovarla.
   *
   * Hace falta porque la caducidad solo se comprobaba en el constructor. Una PWA
   * que se queda abierta días no vuelve a pasar por ahí, así que el usuario
   * seguía navegando con una sesión muerta mientras cada llamada a una Edge
   * Function fallaba en silencio (y con ella el registro del push).
   */
  private registrarListenersDeCiclo(): void {
    if (!isPlatformBrowser(this.platformId) || this.listenersCicloListos) return;

    const alVolver = () => {
      if (document.visibilityState !== 'visible') return;
      if (!this.estaLogueado()) return;

      const token = leerToken();
      if (!token || tokenCaducado(token)) {
        void this.logout('caducada').then(() => this.router.navigateByUrl('/login'));
        return;
      }

      void this.renovarSesion({ respetarThrottle: true });
    };

    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('focus', alVolver);
    this.listenersCicloListos = true;
  }

  /**
   * Borra la sesión local. Si se indica un motivo, deja una marca para que
   * /login pueda explicar al usuario por qué se le pide la clave otra vez.
   */
  private limpiarSesionLocal(motivo?: MotivoFinSesion) {
    if (!isPlatformBrowser(this.platformId)) return;
    localStorage.removeItem(SESSION_USER_KEY);
    localStorage.removeItem(SESSION_TOKEN_KEY);
    localStorage.removeItem(SESSION_LAST_REFRESH_KEY);

    if (motivo) {
      localStorage.setItem(SESSION_END_REASON_KEY, motivo);
    } else {
      // Cierre manual: no hay nada que explicar, y así no se arrastra una marca
      // vieja que reaparecería en el siguiente login.
      localStorage.removeItem(SESSION_END_REASON_KEY);
    }
  }

  private guardarUsuario(usuario: Usuario) {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem(SESSION_USER_KEY, JSON.stringify(usuario));
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
          // error.context es el objeto Response
          // await error.context.json() YA devuelve el objeto JSON parsed, no un string.
          const errBody = await error.context.json();
          return { success: false, error: errBody.error || 'Error al iniciar sesión' };
        } catch (e) {
          console.error('Error parsing response:', e);
          return { success: false, error: 'Error de conexión o credenciales inválidas' };
        }
      }

      if (!data.success) {
        return { success: false, error: data.error || 'Error al iniciar sesión' };
      }

      // Guardar el token JWT personalizado para usar con RLS
      // Nota: No usamos supabase().auth.setSession() porque nuestro JWT es personalizado
      if (isPlatformBrowser(this.platformId)) {
        localStorage.setItem(SESSION_TOKEN_KEY, data.access_token);
        // El token acaba de emitirse: la cuenta atrás del throttle empieza aquí.
        localStorage.setItem(SESSION_LAST_REFRESH_KEY, String(Date.now()));
        localStorage.removeItem(SESSION_END_REASON_KEY);
      }

      const usuarioLimpio: Usuario = {
        id: data.user.id,
        telefono: data.user.telefono,
        nombre: data.user.nombre,
        rol: data.user.rol,
        activo: true,
      };

      this.guardarUsuario(usuarioLimpio);
      this.registrarListenersDeCiclo();

      // Sincronizar push en segundo plano para que OneSignal no bloquee el login.
      void this.sincronizarPushSiHayUsuario();

      return { success: true };

    } catch (error) {
      console.error('Error en login:', error);
      return { success: false, error: 'Error inesperado' };
    }
  }

  /**
   * @param motivo si se indica, /login mostrará el aviso correspondiente y se
   *   entiende que la sesión se ha cerrado sola. Sin motivo es un cierre manual.
   */
  async logout(motivo?: MotivoFinSesion) {
    // Solo se desvincula el dispositivo cuando el usuario cierra sesión a
    // propósito. Si la sesión se cierra sola, se deja el push vinculado: el
    // cliente sigue recibiendo avisos (que es lo que le hace volver a la app) y
    // se evita dejar OneSignal y `push_subscriptions` en estados distintos.
    // Un usuario desactivado no recibe nada de todos modos, porque `send-push`
    // y `register-push-subscription` ya comprueban `usuarios.activo`.
    if (!motivo) {
      await this.pushService.removeToken();
    }

    this.limpiarSesionLocal(motivo);
    this.usuarioActual.set(null);
  }

  async sincronizarPushSiHayUsuario(): Promise<void> {
    if (!this.estaLogueado()) return;
    try {
      await this.pushService.syncCurrentUserSubscription();
    } catch (error) {
      console.warn('[Auth] No se pudo sincronizar push tras login:', error);
    }
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

      const rnaceToken = isPlatformBrowser(this.platformId) ? leerToken() : null;

      // Invocar función segura en el servidor
      const { data, error } = await supabase().functions.invoke('create-user', {
        body: {
          telefono: telefonoLimpio,
          password: datos.password,
          nombre: datos.nombre,
          rol: datos.rol || 'cliente'
        },
        headers: rnaceToken ? { 'x-rnace-token': rnaceToken } : {},
      });

      if (error) {
        // Error de invocación (red, etc)
        console.error('Error invocando create-user:', error);
        // Intentar parsear el error si viene del backend
        let msg = 'Error de conexión';
        try {
          const body = await error.context.json();
          msg = body.error || msg;
        } catch {
          // Si no se puede parsear el body, dejamos el mensaje por defecto
        }
        return { success: false, error: msg };
      }

      if (!data.success) {
        return { success: false, error: data.error || 'Error al crear usuario' };
      }

      return { success: true, userId: data.userId };

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

      const client = supabase();

      // Eliminar dependencias manualmente antes de borrar usuario
      // (Si no hay ON DELETE CASCADE en la base de datos)

      // 1. Recuperaciones
      await client.from('recuperaciones').delete().eq('usuario_id', userId);

      // 2. Reservas
      await client.from('reservas').delete().eq('usuario_id', userId);

      // 3. Lista de espera
      await client.from('lista_espera').delete().eq('usuario_id', userId);

      // 4. Plan y horarios
      await client.from('plan_usuario').delete().eq('usuario_id', userId);
      await client.from('horario_fijo_usuario').delete().eq('usuario_id', userId);

      // 5. Notificaciones y avisos
      await client.from('notificaciones').delete().eq('usuario_id', userId);
      await client.from('avisos_leidos').delete().eq('usuario_id', userId); // Si existe

      // 6. Eliminar usuario finalmente
      const { error } = await client.from('usuarios').delete().eq('id', userId);

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
    try {
      if (this.getRol() !== 'admin') {
        return { success: false, error: 'Solo los administradores pueden cambiar contraseñas' };
      }

      const rnaceToken = isPlatformBrowser(this.platformId) ? leerToken() : null;

      const { data, error } = await supabase().functions.invoke('change-password', {
        body: {
          userId: telefonoOId,
          newPassword: nuevaPassword,
        },
        headers: rnaceToken ? { 'x-rnace-token': rnaceToken } : {},
      });

      if (error) {
        console.error('Error invocando change-password:', error);
        let msg = 'Error de conexión';
        try {
          const body = await error.context.json();
          msg = body.error || msg;
        } catch {
          // Si no se puede parsear el body, dejamos el mensaje por defecto
        }
        return { success: false, error: msg };
      }

      if (!data.success) {
        return { success: false, error: data.error || 'Error al cambiar contraseña' };
      }

      return { success: true };
    } catch (error) {
      console.error('Error:', error);
      return { success: false, error: 'Error inesperado al cambiar contraseña' };
    }
  }
}
