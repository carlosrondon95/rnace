import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject } from 'rxjs';

export interface PushNotification {
  tipo: string;
  titulo: string;
  mensaje: string;
  data?: Record<string, any>;
  timestamp: number;
}

// Declaración global del SDK de OneSignal (cargado desde index.html)
declare global {
  interface Window {
    OneSignalDeferred: Array<(OneSignal: any) => void>;
  }
}

@Injectable({
  providedIn: 'root'
})
export class PushNotificationService {
  private platformId = inject(PLATFORM_ID);
  private oneSignalReady = false;
  private oneSignalInstance: any = null;
  private foregroundListenerReady = false;

  private _permissionStatus = new BehaviorSubject<NotificationPermission>('default');
  private _notification = new BehaviorSubject<PushNotification | null>(null);
  private _isSupported = new BehaviorSubject<boolean>(false);

  permissionStatus$ = this._permissionStatus.asObservable();
  notification$ = this._notification.asObservable();
  isSupported$ = this._isSupported.asObservable();

  private initPromise: Promise<void> | null = null;

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.checkSupport();
    }
  }

  /**
   * Inicializa OneSignal y asocia el external_id del usuario.
   * Debe llamarse después de que el usuario haya iniciado sesión.
   */
  async ensureInitialized(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    if (!this._isSupported.value) return;

    if (!this.initPromise) {
      this.initPromise = this.initializeOneSignal();
    }
    await this.initPromise;
  }

  private checkSupport(): void {
    try {
      const isSupported =
        typeof window !== 'undefined' &&
        'serviceWorker' in navigator &&
        'PushManager' in window &&
        'Notification' in window;

      this._isSupported.next(isSupported);

      if (isSupported) {
        this.checkPermissionStatus();
      }

      // Al abrir la app, dejamos OneSignal listo y vinculado si ya hay usuario local.
      if (isSupported && this.getUserId() && !this.isOptedOut()) {
        if (!this.initPromise) {
          this.initPromise = this.initializeOneSignal();
        }
        this.initPromise.catch(err => console.error('[Push] Auto-init error:', err));
      }

    } catch (e) {
      this._isSupported.next(false);
    }
  }

  isSupported(): boolean {
    return this._isSupported.value;
  }

  private async initializeOneSignal(): Promise<void> {
    try {
      // Esperar a que el SDK de OneSignal esté disponible
      await this.waitForOneSignal();
      this.oneSignalReady = true;

      // Configurar listener de notificaciones en foreground
      this.setupForegroundListener();
      this.checkPermissionStatus();

      if (!this.isOptedOut()) {
        console.log('[Push] OneSignal listo, sincronizando usuario...');
        await this.loginUser();
        await this.ensurePushSubscriptionActive();
      }
    } catch (error) {
      console.error('[Push] Error inicializando OneSignal:', error);
    }
  }

  /**
   * Espera a que el SDK de OneSignal se haya cargado e inicializado.
   * Guarda la referencia al SDK para usarla directamente después.
   */
  private waitForOneSignal(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('OneSignal SDK no estuvo listo tras 15s'));
      }, 15000);

      window.OneSignalDeferred = window.OneSignalDeferred || [];
      window.OneSignalDeferred.push(async (OneSignal: any) => {
        clearTimeout(timeout);
        console.log('[Push] OneSignal SDK listo');
        this.oneSignalInstance = OneSignal;
        resolve();
      });
    });
  }

  /**
   * Asocia el usuario actual de la app con OneSignal usando external_id.
   * Esto es lo que permite que la Edge Function envíe notificaciones al usuario correcto.
   */
  private async loginUser(): Promise<void> {
    const userId = this.getUserId();
    if (!userId) {
      // Reintentar tras breve espera (race condition con AuthService)
      await new Promise(resolve => setTimeout(resolve, 1500));
      const retryId = this.getUserId();
      if (!retryId) {
        console.warn('[Push] No se pudo obtener userId para OneSignal.login()');
        return;
      }
      await this.doOneSignalLogin(retryId);
      return;
    }
    await this.doOneSignalLogin(userId);
  }

  async syncCurrentUserSubscription(): Promise<boolean> {
    if (!isPlatformBrowser(this.platformId) || !this.isSupported()) return false;
    if (this.isOptedOut()) return false;

    await this.ensureInitialized();
    await this.loginUser();
    await this.ensurePushSubscriptionActive();
    this.checkPermissionStatus();

    return this.isEffectivelyEnabled();
  }

  /**
   * Ejecuta OneSignal.login() de forma robusta con reintentos.
   * A diferencia de la versión anterior que usaba OneSignalDeferred.push()
   * (fire-and-forget), esta versión usa la referencia directa al SDK
   * y espera realmente a que el login complete.
   */
  private async doOneSignalLogin(userId: string): Promise<void> {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 2000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (this.oneSignalInstance) {
          // Usar la referencia directa al SDK (más fiable)
          await this.oneSignalInstance.login(userId);
          console.log(`[Push] ✅ OneSignal.login() exitoso para userId: ${userId} (intento ${attempt})`);
          return;
        } else {
          // Fallback: usar el patrón deferred con Promise wrapper
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('OneSignal.login() timeout (10s)'));
            }, 10000);

            window.OneSignalDeferred.push(async (OneSignal: any) => {
              try {
                this.oneSignalInstance = OneSignal;
                await OneSignal.login(userId);
                clearTimeout(timeout);
                console.log(`[Push] ✅ OneSignal.login() exitoso para userId: ${userId} (intento ${attempt}, deferred)`);
                resolve();
              } catch (innerErr) {
                clearTimeout(timeout);
                reject(innerErr);
              }
            });
          });
          return;
        }
      } catch (error) {
        console.error(`[Push] ❌ Error en OneSignal.login() intento ${attempt}/${MAX_RETRIES}:`, error);
        if (attempt < MAX_RETRIES) {
          console.log(`[Push] Reintentando en ${RETRY_DELAY_MS}ms...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    }
    console.error(`[Push] ❌ OneSignal.login() falló después de ${MAX_RETRIES} intentos para userId: ${userId}`);
  }

  private checkPermissionStatus(): void {
    if ('Notification' in window) {
      this._permissionStatus.next(Notification.permission);
    }
  }

  private async ensurePushSubscriptionActive(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    if (!this.oneSignalInstance || Notification.permission !== 'granted') return;

    try {
      const pushSubscription = this.oneSignalInstance.User?.PushSubscription;
      if (pushSubscription?.optIn) {
        await pushSubscription.optIn();
      }
    } catch (error) {
      console.warn('[Push] No se pudo reactivar la suscripcion de OneSignal:', error);
    }
  }

  async requestPermission(): Promise<boolean> {
    if (!this.isSupported()) return false;
    if (!isPlatformBrowser(this.platformId)) return false;

    // Verificar iOS Standalone
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || ('standalone' in navigator && (navigator as any).standalone === true);
    
    if (isIOS && !isStandalone) {
      console.warn('[Push] iOS requiere que la PWA esté instalada (Añadir a pantalla de inicio) para pedir permisos.');
      alert('Para activar las notificaciones en iPhone, primero debes pulsar "Compartir" y "Añadir a la pantalla de inicio".');
      return false;
    }

    await this.ensureInitialized();

    try {
      // Pedir permiso de notificaciones del navegador
      const permission = await Notification.requestPermission();
      this._permissionStatus.next(permission);

      if (permission === 'granted') {
        // Hacer login en OneSignal para asociar el dispositivo al usuario
        await this.loginUser();
        await this.ensurePushSubscriptionActive();
        return true;
      }
      return false;
    } catch (error) {
      console.error('[Push] Error solicitando permiso:', error);
      return false;
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

  private setupForegroundListener(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (this.foregroundListenerReady) return;

    const setupListener = (OneSignal: any) => {
      OneSignal.Notifications.addEventListener('foregroundWillDisplay', (event: any) => {
        console.log('[Push] Notificación en foreground:', event);

        const notification = event.notification;
        const pushNotif: PushNotification = {
          tipo: notification.additionalData?.tipo || 'default',
          titulo: notification.title || 'RNACE',
          mensaje: notification.body || '',
          data: notification.additionalData,
          timestamp: Date.now()
        };

        this._notification.next(pushNotif);

        // Dejar que OneSignal muestre la notificación nativamente
        // (por defecto ya la muestra, no necesitamos showNotification manual)
      });
      this.foregroundListenerReady = true;
    };

    if (this.oneSignalInstance) {
      setupListener(this.oneSignalInstance);
    } else {
      window.OneSignalDeferred.push(async (OneSignal: any) => {
        this.oneSignalInstance = OneSignal;
        setupListener(OneSignal);
      });
    }
  }

  /**
   * Desvincula el dispositivo del usuario al cerrar sesión.
   */
  async removeToken(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    try {
      if (this.oneSignalInstance) {
        await this.oneSignalInstance.logout();
        console.log('[Push] OneSignal.logout() completado');
      } else {
        window.OneSignalDeferred.push(async (OneSignal: any) => {
          await OneSignal.logout();
          console.log('[Push] OneSignal.logout() completado');
        });
      }
    } catch (error) {
      console.error('[Push] Error en logout:', error);
    }
  }

  getPermissionStatus(): NotificationPermission {
    return this._permissionStatus.value;
  }

  hasToken(): boolean {
    // Con OneSignal, si tiene permiso y no ha hecho opt-out, consideramos que tiene "token"
    return this._permissionStatus.value === 'granted' && !this.isOptedOut();
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
   * (granted permission AND not opted out)
   */
  isEffectivelyEnabled(): boolean {
    return this._permissionStatus.value === 'granted' &&
      !this.isOptedOut();
  }

  /**
   * Opt out of push notifications (user preference)
   * This does a OneSignal logout but keeps browser permission
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

    // If permission already granted, just login again
    if (this._permissionStatus.value === 'granted') {
      await this.loginUser();
      await this.ensurePushSubscriptionActive();
      return true;
    }

    // Otherwise, request permission
    return await this.requestPermission();
  }
}
