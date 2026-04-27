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

export interface OneSignalPushSubscriptionState {
  id: string | null;
  token: string | null;
  optedIn: boolean;
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
  private permissionListenerReady = false;
  private subscriptionListenerReady = false;

  private _permissionStatus = new BehaviorSubject<NotificationPermission>('default');
  private _notification = new BehaviorSubject<PushNotification | null>(null);
  private _isSupported = new BehaviorSubject<boolean>(false);
  private _oneSignalSubscription = new BehaviorSubject<OneSignalPushSubscriptionState>({
    id: null,
    token: null,
    optedIn: false,
  });

  permissionStatus$ = this._permissionStatus.asObservable();
  notification$ = this._notification.asObservable();
  isSupported$ = this._isSupported.asObservable();
  oneSignalSubscription$ = this._oneSignalSubscription.asObservable();

  private initPromise: Promise<void> | null = null;
  private syncPromise: Promise<boolean> | null = null;
  private permissionRequestPromise: Promise<boolean> | null = null;
  private grantedSubscriptionPromise: Promise<boolean> | null = null;

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
      this.setupOneSignalStateListeners();
      this.updateSupportFromOneSignal();
      this.checkPermissionStatus();
      this.updateOneSignalSubscriptionState();

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

    if (!this.syncPromise) {
      this.syncPromise = this.syncCurrentUserSubscriptionOnce().finally(() => {
        this.syncPromise = null;
      });
    }

    return await this.syncPromise;
  }

  private async syncCurrentUserSubscriptionOnce(): Promise<boolean> {
    await this.ensureInitialized();

    if (!this.oneSignalInstance) {
      this.checkPermissionStatus();
      return false;
    }

    await this.loginUser();
    await this.ensurePushSubscriptionActive();
    this.checkPermissionStatus();
    this.updateOneSignalSubscriptionState();
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
    if (isPlatformBrowser(this.platformId) && 'Notification' in window) {
      this._permissionStatus.next(Notification.permission);
    }
  }

  private updateSupportFromOneSignal(): void {
    if (!this.oneSignalInstance?.Notifications?.isPushSupported) return;

    try {
      this._isSupported.next(Boolean(this.oneSignalInstance.Notifications.isPushSupported()));
    } catch (error) {
      console.warn('[Push] No se pudo verificar soporte con OneSignal:', error);
    }
  }

  private readOneSignalSubscriptionState(): OneSignalPushSubscriptionState {
    const pushSubscription = this.oneSignalInstance?.User?.PushSubscription;

    return {
      id: pushSubscription?.id ?? null,
      token: pushSubscription?.token ?? null,
      optedIn: pushSubscription?.optedIn === true,
    };
  }

  private updateOneSignalSubscriptionState(state?: OneSignalPushSubscriptionState): void {
    this._oneSignalSubscription.next(state ?? this.readOneSignalSubscriptionState());
  }

  private hasRegisteredOneSignalSubscription(): boolean {
    const subscription = this._oneSignalSubscription.value;
    return subscription.optedIn && Boolean(subscription.id || subscription.token);
  }

  private async waitForRegisteredSubscription(timeoutMs = 10000): Promise<boolean> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      this.checkPermissionStatus();
      this.updateOneSignalSubscriptionState();

      if (this.isEffectivelyEnabled()) {
        return true;
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    this.checkPermissionStatus();
    this.updateOneSignalSubscriptionState();
    return this.isEffectivelyEnabled();
  }

  private async ensurePushSubscriptionActive(): Promise<boolean> {
    if (!this.grantedSubscriptionPromise) {
      this.grantedSubscriptionPromise = this.ensurePushSubscriptionActiveOnce().finally(() => {
        this.grantedSubscriptionPromise = null;
      });
    }

    return await this.grantedSubscriptionPromise;
  }

  private async ensurePushSubscriptionActiveOnce(): Promise<boolean> {
    if (!isPlatformBrowser(this.platformId)) return false;
    this.checkPermissionStatus();

    if (
      !this.oneSignalInstance ||
      !('Notification' in window) ||
      Notification.permission !== 'granted' ||
      this.isOptedOut()
    ) {
      this.updateOneSignalSubscriptionState();
      return false;
    }

    try {
      await this.loginUser();
      const pushSubscription = this.oneSignalInstance.User?.PushSubscription;
      if (pushSubscription?.optIn) {
        await pushSubscription.optIn();
      }
      this.updateOneSignalSubscriptionState();
      const registered = await this.waitForRegisteredSubscription();
      if (registered) {
        await this.loginUser();
      }
      return registered;
    } catch (error) {
      console.warn('[Push] No se pudo reactivar la suscripcion de OneSignal:', error);
      this.updateOneSignalSubscriptionState();
      return false;
    }
  }

  async requestPermission(): Promise<boolean> {
    if (!this.permissionRequestPromise) {
      this.permissionRequestPromise = this.requestPermissionOnce().finally(() => {
        this.permissionRequestPromise = null;
      });
    }

    return await this.permissionRequestPromise;
  }

  private async requestPermissionOnce(): Promise<boolean> {
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
      await this.loginUser();

      const pushSubscription = this.oneSignalInstance?.User?.PushSubscription;

      if (pushSubscription?.optIn) {
        // OneSignal optIn re-subscribes if a token exists, or asks for native permission if needed.
        await pushSubscription.optIn();
      } else if (this.oneSignalInstance?.Notifications?.requestPermission) {
        await this.oneSignalInstance.Notifications.requestPermission();
      } else {
        await Notification.requestPermission();
      }

      this.checkPermissionStatus();

      if (this._permissionStatus.value !== 'granted') return false;

      return await this.ensurePushSubscriptionActive();
    } catch (error) {
      console.error('[Push] Error solicitando permiso:', error);
      this.checkPermissionStatus();
      this.updateOneSignalSubscriptionState();
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

  private setupOneSignalStateListeners(): void {
    if (!isPlatformBrowser(this.platformId) || !this.oneSignalInstance) return;

    const notifications = this.oneSignalInstance.Notifications;
    if (!this.permissionListenerReady && notifications?.addEventListener) {
      notifications.addEventListener('permissionChange', async (permission: boolean) => {
        this.checkPermissionStatus();
        this.updateOneSignalSubscriptionState();

        if (permission && !this.isOptedOut()) {
          await this.loginUser();
          await this.ensurePushSubscriptionActive();
        }
      });
      this.permissionListenerReady = true;
    }

    const pushSubscription = this.oneSignalInstance.User?.PushSubscription;
    if (!this.subscriptionListenerReady && pushSubscription?.addEventListener) {
      pushSubscription.addEventListener('change', async (event: any) => {
        const current = event?.current;
        this.updateOneSignalSubscriptionState(current
          ? {
              id: current.id ?? null,
              token: current.token ?? null,
              optedIn: current.optedIn === true,
            }
          : undefined);
        this.checkPermissionStatus();

        if (this.getUserId() && current?.optedIn === true && !this.isOptedOut()) {
          await this.loginUser();
        }
      });
      this.subscriptionListenerReady = true;
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
    return this.isEffectivelyEnabled();
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
    if (this._permissionStatus.value !== 'granted' || this.isOptedOut()) {
      return false;
    }

    return this.oneSignalReady && this.hasRegisteredOneSignalSubscription();
  }

  /**
   * Opt out of push notifications (user preference)
   * This does a OneSignal logout but keeps browser permission
   */
  async optOutNotifications(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    try {
      await this.ensureInitialized();
      const pushSubscription = this.oneSignalInstance?.User?.PushSubscription;
      if (pushSubscription?.optOut) {
        await pushSubscription.optOut();
      }
    } catch (error) {
      console.warn('[Push] No se pudo hacer optOut en OneSignal:', error);
    } finally {
      localStorage.setItem('rnace_push_optout', 'true');
      await this.removeToken();
      this.updateOneSignalSubscriptionState();
    }
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
      return await this.ensurePushSubscriptionActive();
    }

    // Otherwise, request permission
    return await this.requestPermission();
  }
}
