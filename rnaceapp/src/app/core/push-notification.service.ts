import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject } from 'rxjs';
import { environment } from '../../environments/environment';
import { supabase } from './supabase.client';

// Define needed types locally or import type only
import type { FirebaseApp } from 'firebase/app';
import type { Messaging } from 'firebase/messaging';

export interface PushNotification {
  tipo: string;
  titulo: string;
  mensaje: string;
  data?: Record<string, any>;
  timestamp: number;
}

@Injectable({
  providedIn: 'root'
})
export class PushNotificationService {
  private platformId = inject(PLATFORM_ID);
  private firebaseApp: FirebaseApp | null = null;
  private messaging: Messaging | null = null;

  private _currentToken = new BehaviorSubject<string | null>(null);
  private _permissionStatus = new BehaviorSubject<NotificationPermission>('default');
  private _notification = new BehaviorSubject<PushNotification | null>(null);
  private _isSupported = new BehaviorSubject<boolean>(false);

  currentToken$ = this._currentToken.asObservable();
  permissionStatus$ = this._permissionStatus.asObservable();
  notification$ = this._notification.asObservable();
  isSupported$ = this._isSupported.asObservable();

  private initialized = false;

  constructor() {
    // Solo verificar soporte en el constructor, NO inicializar Firebase
    // La inicialización se hace de forma lazy para evitar "Worker is not defined"
    if (isPlatformBrowser(this.platformId)) {
      this.checkSupport();
    }
  }

  /**
   * Inicializa Firebase de forma lazy.
   * Debe llamarse después de que el usuario haya iniciado sesión.
   */
  async ensureInitialized(): Promise<void> {
    if (this.initialized || !isPlatformBrowser(this.platformId)) return;
    if (!this._isSupported.value) return;

    await this.initializeFirebase();
    this.initialized = true;
  }

  private checkSupport(): void {
    try {
      const isSupported =
        typeof window !== 'undefined' &&
        'serviceWorker' in navigator &&
        'PushManager' in window &&
        'Notification' in window;

      this._isSupported.next(isSupported);
    } catch (e) {
      this._isSupported.next(false);
    }
  }

  isSupported(): boolean {
    return this._isSupported.value;
  }

  private async initializeFirebase(): Promise<void> {
    try {
      if (!environment.firebase?.apiKey) {
        console.warn('[Push] Firebase no configurado');
        return;
      }

      // Dynamic imports to avoid SSR issues
      const { initializeApp } = await import('firebase/app');
      const { getMessaging, onMessage } = await import('firebase/messaging');

      this.firebaseApp = initializeApp(environment.firebase);
      this.messaging = getMessaging(this.firebaseApp);

      this.setupForegroundListener(onMessage);
      this.checkPermissionStatus();
    } catch (error) {
      console.error('[Push] Error inicializando Firebase:', error);
    }
  }

  private checkPermissionStatus(): void {
    if ('Notification' in window) {
      this._permissionStatus.next(Notification.permission);
    }
  }

  async requestPermission(): Promise<boolean> {
    if (!this.isSupported()) return false;
    // Extra safety: never run on server
    if (!isPlatformBrowser(this.platformId)) return false;

    // Asegurar que Firebase esté inicializado antes de solicitar permisos
    await this.ensureInitialized();

    try {
      const permission = await Notification.requestPermission();
      this._permissionStatus.next(permission);

      if (permission === 'granted') {
        const token = await this.getAndSaveToken();
        return token !== null;
      }
      return false;
    } catch (error) {
      console.error('[Push] Error solicitando permiso:', error);
      return false;
    }
  }

  async getAndSaveToken(): Promise<string | null> {
    if (!this.messaging || !isPlatformBrowser(this.platformId)) return null;

    try {
      // Dynamic import again just to be safe inside the method
      const { getToken } = await import('firebase/messaging');

      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      await navigator.serviceWorker.ready;

      const token = await getToken(this.messaging, {
        vapidKey: environment.firebaseVapidKey,
        serviceWorkerRegistration: registration
      });

      if (token) {
        this._currentToken.next(token);
        await this.saveTokenToSupabase(token);
        return token;
      }
      return null;
    } catch (error) {
      console.error('[Push] Error obteniendo token:', error);
      return null;
    }
  }

  // Obtener userId desde localStorage (tu sistema de auth)
  private getUserId(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    try {
      const guardado = localStorage.getItem('rnace_usuario');
      if (guardado) {
        const usuario = JSON.parse(guardado);
        return usuario.id || null;
      }
    } catch (error) {
      console.error('[Push] Error obteniendo userId:', error);
    }
    return null;
  }

  private async saveTokenToSupabase(token: string): Promise<void> {
    try {
      const userId = this.getUserId();
      if (!userId) {
        console.warn('[Push] Usuario no autenticado, no se guarda token');
        return;
      }

      // Check navigator safety
      const userAgent = isPlatformBrowser(this.platformId) ? navigator.userAgent : 'Server';
      const deviceInfo = /iPhone|iPad|iPod/.test(userAgent) ? 'iOS' :
        /Android/.test(userAgent) ? 'Android' : 'Web';

      const { error } = await supabase()
        .from('fcm_tokens')
        .upsert({
          user_id: userId,
          token: token,
          device_info: deviceInfo,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id,token' });

      if (error) {
        console.error('[Push] Error en upsert:', error);
      } else {
        console.log('[Push] Token guardado correctamente');
      }

    } catch (error) {
      console.error('[Push] Error guardando token:', error);
    }
  }

  private setupForegroundListener(onMessageFn: any): void {
    if (!this.messaging || !isPlatformBrowser(this.platformId)) return;

    onMessageFn(this.messaging, (payload: any) => {
      console.log('[Push] Notificación en foreground:', payload);

      const notification: PushNotification = {
        tipo: payload.data?.['tipo'] || 'default',
        titulo: payload.notification?.title || 'RNACE',
        mensaje: payload.notification?.body || '',
        data: payload.data,
        timestamp: Date.now()
      };

      this._notification.next(notification);

      // Mostrar notificación nativa en foreground
      if (Notification.permission === 'granted') {
        new Notification(notification.titulo, {
          body: notification.mensaje,
          icon: '/icons/icon-192x192.png'
        });
      }
    });
  }

  async removeToken(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    const token = this._currentToken.value;
    if (!token) return;

    try {
      const userId = this.getUserId();
      if (userId) {
        const { error } = await supabase()
          .from('fcm_tokens')
          .delete()
          .match({ user_id: userId, token: token });

        if (error) {
          console.error('[Push] Error eliminando token:', error);
        } else {
          console.log('[Push] Token eliminado correctamente');
        }
      }
      this._currentToken.next(null);
    } catch (error) {
      console.error('[Push] Error eliminando token:', error);
    }
  }

  getPermissionStatus(): NotificationPermission {
    return this._permissionStatus.value;
  }

  hasToken(): boolean {
    return this._currentToken.value !== null;
  }

  /**
   * Check if user has opted out of notifications (stored locally)
   */
  isOptedOut(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    return localStorage.getItem('rnace_push_optout') === 'true';
  }

  /**
   * Check if push notifications are effectively enabled
   * (granted permission AND not opted out AND has token)
   */
  isEffectivelyEnabled(): boolean {
    return this._permissionStatus.value === 'granted' &&
      !this.isOptedOut() &&
      this._currentToken.value !== null;
  }

  /**
   * Opt out of push notifications (user preference)
   * This removes the FCM token but keeps browser permission
   */
  async optOutNotifications(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    localStorage.setItem('rnace_push_optout', 'true');
    await this.removeToken();
  }

  /**
   * Opt back in to push notifications
   * Returns true if successfully re-enabled
   */
  async optInNotifications(): Promise<boolean> {
    if (!isPlatformBrowser(this.platformId)) return false;

    localStorage.removeItem('rnace_push_optout');

    // If permission already granted, just get a new token
    if (this._permissionStatus.value === 'granted') {
      const token = await this.getAndSaveToken();
      return token !== null;
    }

    // Otherwise, request permission
    return await this.requestPermission();
  }
}
