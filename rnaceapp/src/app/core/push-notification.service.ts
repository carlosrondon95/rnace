import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject } from 'rxjs';
import { supabase } from './supabase.client';

export interface PushNotification {
  tipo: string;
  titulo: string;
  mensaje: string;
  data?: Record<string, any>;
  timestamp: number;
}

export interface OneSignalPushSubscriptionState {
  onesignalId: string | null;
  externalId: string | null;
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
  private userListenerReady = false;
  private lifecycleListenerReady = false;
  private lastSavedSubscriptionSignature: string | null = null;
  private saveSubscriptionPromise: Promise<boolean> | null = null;
  private readonly sdkReadyTimeoutMs = 15000;
  private readonly oneSignalLoginTimeoutMs = 12000;
  private readonly oneSignalOptInTimeoutMs = 15000;
  private readonly permissionPromptTimeoutMs = 30000;
  private readonly registerSubscriptionTimeoutMs = 15000;
  private readonly logPushActivationTimeoutMs = 6000;

  private _permissionStatus = new BehaviorSubject<NotificationPermission>('default');
  private _notification = new BehaviorSubject<PushNotification | null>(null);
  private _isSupported = new BehaviorSubject<boolean>(false);
  private _oneSignalSubscription = new BehaviorSubject<OneSignalPushSubscriptionState>({
    onesignalId: null,
    externalId: null,
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
      this.setupLifecycleSyncListeners();
      this.updateSupportFromOneSignal();
      this.checkPermissionStatus();
      this.updateOneSignalSubscriptionState();

      if (!this.isOptedOut()) {
        void this.syncOneSignalUserAfterInit('initializeOneSignal');
      }
    } catch (error) {
      console.error('[Push] Error inicializando OneSignal:', error);
      this.initPromise = null;
    }
  }

  private async syncOneSignalUserAfterInit(contexto: string): Promise<void> {
    try {
      console.log(`[Push] OneSignal listo, sincronizando usuario (${contexto})...`);
      await this.loginUser();
      await this.ensurePushSubscriptionActive();
      this.scheduleSubscriptionRelinkChecks(contexto);
    } catch (error) {
      console.warn(`[Push] ${contexto}: no se pudo sincronizar usuario en segundo plano`, error);
    }
  }

  /**
   * Espera a que el SDK de OneSignal se haya cargado e inicializado.
   * Guarda la referencia al SDK para usarla directamente después.
   */
  private waitForOneSignal(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`OneSignal SDK no estuvo listo tras ${this.sdkReadyTimeoutMs / 1000}s`));
      }, this.sdkReadyTimeoutMs);

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
  private async loginUser(): Promise<boolean> {
    const userId = this.getUserId();
    if (!userId) {
      // Reintentar tras breve espera (race condition con AuthService)
      await new Promise(resolve => setTimeout(resolve, 1500));
      const retryId = this.getUserId();
      if (!retryId) {
        console.warn('[Push] No se pudo obtener userId para OneSignal.login()');
        return false;
      }
      return await this.doOneSignalLogin(retryId);
    }
    return await this.doOneSignalLogin(userId);
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private serializeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }

  private async logPushActivation(
    event: string,
    level: 'info' | 'warn' | 'error',
    message: string,
    details: Record<string, any> = {},
  ): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    const authToken = this.getAuthToken();
    if (!authToken) return;

    const state = this._oneSignalSubscription.value;

    try {
      const { error } = await this.withTimeout(
        supabase().functions.invoke('push-activation-log', {
          headers: {
            'x-rnace-token': authToken,
          },
          body: {
            event,
            level,
            message,
            user_agent: navigator.userAgent,
            details: {
              permission: this._permissionStatus.value,
              supported: this._isSupported.value,
              opted_out: this.isOptedOut(),
              onesignal_ready: this.oneSignalReady,
              onesignal_id: state.onesignalId,
              external_id: state.externalId,
              subscription_id: state.id,
              has_token: Boolean(state.token),
              opted_in: state.optedIn,
              ...details,
            },
          },
        }),
        this.logPushActivationTimeoutMs,
        `push-activation-log timeout (${this.logPushActivationTimeoutMs / 1000}s)`,
      );

      if (error) {
        console.warn('[PushLog] No se pudo guardar log de activacion push:', error);
      }
    } catch (error) {
      console.warn('[PushLog] Error guardando log de activacion push:', error);
    }
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
    await this.relinkCurrentSubscription('syncCurrentUserSubscription');
    this.checkPermissionStatus();
    this.updateOneSignalSubscriptionState();
    this.logOneSignalState('syncCurrentUserSubscription');
    this.scheduleSubscriptionRelinkChecks('syncCurrentUserSubscription');
    return this.isEffectivelyEnabled();
  }

  /**
   * Ejecuta OneSignal.login() de forma robusta con reintentos.
   * A diferencia de la versión anterior que usaba OneSignalDeferred.push()
   * (fire-and-forget), esta versión usa la referencia directa al SDK
   * y espera realmente a que el login complete.
   */
  private async doOneSignalLogin(usuarioId: string): Promise<boolean> {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 2000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (this.oneSignalInstance) {
          // Usar la referencia directa al SDK (más fiable)
          await this.withTimeout(
            Promise.resolve(this.oneSignalInstance.login(usuarioId)),
            this.oneSignalLoginTimeoutMs,
            `OneSignal.login() timeout (${this.oneSignalLoginTimeoutMs / 1000}s)`,
          );
          await this.waitForExternalId(usuarioId);
          this.updateOneSignalSubscriptionState();
          await this.saveCurrentSubscription('doOneSignalLogin');
          console.log(`[Push] OneSignal.login() exitoso para usuario_id: ${usuarioId} (intento ${attempt})`);
          return this.isLinkedToCurrentUser();
        } else {
          // Fallback: usar el patrón deferred con Promise wrapper
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('OneSignal.login() timeout (10s)'));
            }, 10000);

            window.OneSignalDeferred.push(async (OneSignal: any) => {
              try {
                this.oneSignalInstance = OneSignal;
                await this.withTimeout(
                  Promise.resolve(OneSignal.login(usuarioId)),
                  this.oneSignalLoginTimeoutMs,
                  `OneSignal.login() timeout (${this.oneSignalLoginTimeoutMs / 1000}s)`,
                );
                clearTimeout(timeout);
                console.log(`[Push] OneSignal.login() exitoso para usuario_id: ${usuarioId} (intento ${attempt}, deferred)`);
                resolve();
              } catch (innerErr) {
                clearTimeout(timeout);
                reject(innerErr);
              }
            });
          });
          await this.waitForExternalId(usuarioId);
          this.updateOneSignalSubscriptionState();
          await this.saveCurrentSubscription('doOneSignalLogin-deferred');
          return this.isLinkedToCurrentUser();
        }
      } catch (error) {
        console.error(`[Push] Error en OneSignal.login() intento ${attempt}/${MAX_RETRIES}:`, error);
        if (attempt < MAX_RETRIES) {
          console.log(`[Push] Reintentando en ${RETRY_DELAY_MS}ms...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    }
    console.error(`[Push] OneSignal.login() fallo despues de ${MAX_RETRIES} intentos para usuario_id: ${usuarioId}`);
    return false;
  }

  private checkPermissionStatus(): void {
    if (isPlatformBrowser(this.platformId) && 'Notification' in window) {
      this._permissionStatus.next(Notification.permission);
    }
  }

  private async requestBrowserPermissionFromUserGesture(): Promise<NotificationPermission> {
    this.checkPermissionStatus();
    if (this._permissionStatus.value !== 'default') {
      return this._permissionStatus.value;
    }

    const oneSignalRequestPermission = this.oneSignalInstance?.Notifications?.requestPermission;

    if (oneSignalRequestPermission) {
      try {
        await this.withTimeout(
          Promise.resolve(oneSignalRequestPermission.call(this.oneSignalInstance.Notifications)),
          this.permissionPromptTimeoutMs,
          `OneSignal.Notifications.requestPermission() timeout (${this.permissionPromptTimeoutMs / 1000}s)`,
        );
        this.checkPermissionStatus();
        return await this.waitForPermissionDecision();
      } catch (error) {
        console.warn('[Push] OneSignal no completo requestPermission, usando prompt nativo:', error);
      }
    }

    const result = await this.withTimeout(
      Notification.requestPermission(),
      this.permissionPromptTimeoutMs,
      `Notification.requestPermission() timeout (${this.permissionPromptTimeoutMs / 1000}s)`,
    );

    if (typeof result === 'string') {
      this._permissionStatus.next(result as NotificationPermission);
    } else {
      this.checkPermissionStatus();
    }

    return await this.waitForPermissionDecision();
  }

  private async waitForPermissionDecision(timeoutMs = 3000): Promise<NotificationPermission> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      this.checkPermissionStatus();

      if (this._permissionStatus.value !== 'default') {
        return this._permissionStatus.value;
      }

      await new Promise(resolve => setTimeout(resolve, 150));
    }

    this.checkPermissionStatus();
    return this._permissionStatus.value;
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
    const user = this.oneSignalInstance?.User;
    const pushSubscription = user?.PushSubscription;

    return {
      onesignalId: user?.onesignalId ?? null,
      externalId: user?.externalId ?? null,
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

  private hasOneSignalSubscriptionId(): boolean {
    return Boolean(this._oneSignalSubscription.value.id);
  }

  private isLinkedToCurrentUser(state = this._oneSignalSubscription.value): boolean {
    const usuarioId = this.getUserId();
    return Boolean(usuarioId && state.externalId === usuarioId);
  }

  private async waitForExternalId(usuarioId: string, timeoutMs = 5000): Promise<boolean> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      this.updateOneSignalSubscriptionState();

      if (this._oneSignalSubscription.value.externalId === usuarioId) {
        return true;
      }

      await new Promise(resolve => setTimeout(resolve, 250));
    }

    this.updateOneSignalSubscriptionState();
    const externalId = this._oneSignalSubscription.value.externalId;
    if (externalId !== usuarioId) {
      console.warn('[Push] OneSignal.external_id no coincide con usuarios.id', {
        usuario_id: usuarioId,
        external_id: externalId,
      });
    }
    return externalId === usuarioId;
  }

  private async relinkCurrentSubscription(contexto: string): Promise<boolean> {
    if (!isPlatformBrowser(this.platformId) || !this.oneSignalInstance || this.isOptedOut()) {
      return false;
    }

    const usuarioId = this.getUserId();
    if (!usuarioId) return false;

    this.checkPermissionStatus();
    this.updateOneSignalSubscriptionState();

    const state = this._oneSignalSubscription.value;
    const hasSubscription = state.optedIn && Boolean(state.id || state.token);
    const linked = state.externalId === usuarioId;

    if (!hasSubscription && this._permissionStatus.value !== 'granted') {
      return false;
    }

    if (!linked) {
      console.warn(`[Push] ${contexto}: re-vinculando OneSignal external_id`, {
        usuario_id: usuarioId,
        onesignal_id: state.onesignalId,
        external_id: state.externalId,
        subscription_id: state.id,
        opted_in: state.optedIn,
      });
      await this.loginUser();
      this.updateOneSignalSubscriptionState();
    }

    await this.saveCurrentSubscription(contexto);
    return this.isEffectivelyEnabled();
  }

  private scheduleSubscriptionRelinkChecks(contexto: string): void {
    if (!isPlatformBrowser(this.platformId)) return;

    [2000, 8000, 20000].forEach((delayMs) => {
      setTimeout(() => {
        void this.relinkCurrentSubscription(`${contexto}+${delayMs}ms`);
      }, delayMs);
    });
  }

  private logOneSignalState(contexto: string): void {
    const state = this._oneSignalSubscription.value;
    console.log(`[Push] Estado OneSignal (${contexto})`, {
      usuario_id: this.getUserId(),
      onesignal_id: state.onesignalId,
      external_id: state.externalId,
      subscription_id: state.id,
      has_token: Boolean(state.token),
      opted_in: state.optedIn,
      permission: this._permissionStatus.value,
      enabled: this.isEffectivelyEnabled(),
    });
  }

  private async waitForRegisteredSubscription(timeoutMs = 10000): Promise<boolean> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      this.checkPermissionStatus();
      this.updateOneSignalSubscriptionState();

      if (this.hasRegisteredOneSignalSubscription()) {
        await this.saveCurrentSubscription('waitForRegisteredSubscription');
        return true;
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    this.checkPermissionStatus();
    this.updateOneSignalSubscriptionState();
    if (this.hasRegisteredOneSignalSubscription()) {
      await this.saveCurrentSubscription('waitForRegisteredSubscription-timeout');
      return true;
    }
    return false;
  }

  private async optInPushSubscription(contexto: string): Promise<boolean> {
    const pushSubscription = this.oneSignalInstance?.User?.PushSubscription;

    if (!pushSubscription?.optIn) {
      this.updateOneSignalSubscriptionState();
      console.warn(`[Push] ${contexto}: OneSignal.User.PushSubscription.optIn no esta disponible`);
      return this.hasRegisteredOneSignalSubscription();
    }

    const optInPromise = Promise.resolve(pushSubscription.optIn());
    try {
      await this.withTimeout(
        optInPromise,
        this.oneSignalOptInTimeoutMs,
        `OneSignal.PushSubscription.optIn() timeout (${this.oneSignalOptInTimeoutMs / 1000}s)`,
      );
    } catch (error) {
      console.warn(`[Push] ${contexto}: OneSignal optIn no completo a tiempo`, error);
      this.watchLateOptInCompletion(optInPromise, contexto);
      void this.logPushActivation(
        'optin_timeout',
        'warn',
        'OneSignal optIn no completo a tiempo',
        { contexto, error: this.serializeError(error) },
      );
    }

    this.checkPermissionStatus();
    this.updateOneSignalSubscriptionState();

    if (this.hasRegisteredOneSignalSubscription()) {
      await this.saveCurrentSubscription(`${contexto}-optIn`);
      return true;
    }

    const registered = await this.waitForRegisteredSubscription(12000);
    if (!registered) {
      this.logOneSignalState(`${contexto}: sin subscription registrada tras optIn`);
      void this.logPushActivation(
        'subscription_missing',
        'warn',
        'No aparecio subscription_id ni token tras optIn',
        { contexto },
      );
    }
    return registered;
  }

  private watchLateOptInCompletion(optInPromise: Promise<unknown>, contexto: string): void {
    optInPromise
      .then(async () => {
        this.checkPermissionStatus();
        this.updateOneSignalSubscriptionState();

        if (!this.hasRegisteredOneSignalSubscription()) {
          return;
        }

        await this.saveCurrentSubscription(`${contexto}-optIn-late`);
        await this.relinkCurrentSubscription(`${contexto}-optIn-late`);
        void this.logPushActivation(
          'optin_completed_after_timeout',
          'info',
          'OneSignal optIn completo despues del timeout',
          { contexto },
        );
      })
      .catch((error) => {
        console.warn(`[Push] ${contexto}: OneSignal optIn fallo despues del timeout`, error);
      });
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
      const optedIn = await this.optInPushSubscription('ensurePushSubscriptionActive');
      await this.loginUser();
      this.updateOneSignalSubscriptionState();
      await this.saveCurrentSubscription('ensurePushSubscriptionActive');
      const registered = optedIn || await this.waitForRegisteredSubscription();
      await this.relinkCurrentSubscription('ensurePushSubscriptionActive');
      return registered || this.isEffectivelyEnabled();
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
    localStorage.removeItem('rnace_push_optout');

    // Verificar iOS Standalone
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || ('standalone' in navigator && (navigator as any).standalone === true);
    
    if (isIOS && !isStandalone) {
      console.warn('[Push] iOS requiere que la PWA esté instalada (Añadir a pantalla de inicio) para pedir permisos.');
      alert('Para activar las notificaciones en iPhone, primero debes pulsar "Compartir" y "Añadir a la pantalla de inicio".');
      return false;
    }

    try {
      const permission = await this.requestBrowserPermissionFromUserGesture();
      if (permission !== 'granted') {
        void this.logPushActivation(
          'permission_not_granted',
          permission === 'denied' ? 'error' : 'warn',
          'El permiso de notificaciones no quedo concedido',
          { permission },
        );
        return false;
      }

      await this.ensureInitialized();
      await this.loginUser();
      await this.optInPushSubscription('requestPermission');

      this.checkPermissionStatus();
      if (this._permissionStatus.value !== 'granted') return false;

      const enabled = await this.ensurePushSubscriptionActive();
      await this.saveCurrentSubscription('requestPermission');
      this.scheduleSubscriptionRelinkChecks('requestPermission');
      return enabled;
    } catch (error) {
      console.error('[Push] Error solicitando permiso:', error);
      void this.logPushActivation(
        'permission_flow_error',
        'error',
        'Error solicitando permiso o creando subscription',
        { error: this.serializeError(error) },
      );
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

  private getAuthToken(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    return localStorage.getItem('rnace_token');
  }

  private async saveCurrentSubscription(
    contexto: string,
    optedInOverride?: boolean,
  ): Promise<boolean> {
    if (!isPlatformBrowser(this.platformId)) return false;

    const usuarioId = this.getUserId();
    const authToken = this.getAuthToken();
    const state = this._oneSignalSubscription.value;
    const externalId = state.externalId === usuarioId ? state.externalId : usuarioId;

    if (!usuarioId || !authToken || !state.id) {
      return false;
    }

    const optedIn =
      optedInOverride ??
      (state.optedIn && this._permissionStatus.value === 'granted' && !this.isOptedOut());

    if (optedInOverride === undefined && !optedIn) {
      return false;
    }

    const signature = [
      usuarioId,
      state.id,
      state.token ?? '',
      state.onesignalId ?? '',
      externalId,
      optedIn ? '1' : '0',
    ].join('|');

    if (signature === this.lastSavedSubscriptionSignature) {
      return true;
    }

    if (this.saveSubscriptionPromise) {
      return await this.saveSubscriptionPromise;
    }

    this.saveSubscriptionPromise = (async () => {
      try {
        const { error } = await this.withTimeout(
          supabase().functions.invoke('register-push-subscription', {
            headers: {
              'x-rnace-token': authToken,
            },
            body: {
              usuario_id: usuarioId,
              subscription_id: state.id,
              token: state.token,
              onesignal_id: state.onesignalId,
              external_id: externalId,
              opted_in: optedIn,
              user_agent: navigator.userAgent,
            },
          }),
          this.registerSubscriptionTimeoutMs,
          `register-push-subscription timeout (${this.registerSubscriptionTimeoutMs / 1000}s)`,
        );

        if (error) {
          console.warn(`[Push] ${contexto}: no se pudo registrar la subscription en Supabase`, error);
          void this.logPushActivation(
            'register_subscription_error',
            'error',
            'No se pudo registrar la subscription en Supabase',
            { contexto, error: error.message },
          );
          return false;
        }

        this.lastSavedSubscriptionSignature = signature;
        console.log(`[Push] ${contexto}: subscription guardada`, {
          usuario_id: usuarioId,
          subscription_id: state.id,
          external_id: externalId,
          opted_in: optedIn,
        });
        return true;
      } catch (error) {
        console.warn(`[Push] ${contexto}: error guardando subscription`, error);
        void this.logPushActivation(
          'register_subscription_exception',
          'error',
          'Error guardando subscription',
          { contexto, error: this.serializeError(error) },
        );
        return false;
      } finally {
        this.saveSubscriptionPromise = null;
      }
    })();

    return await this.saveSubscriptionPromise;
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
          await this.saveCurrentSubscription('permissionChange');
          this.scheduleSubscriptionRelinkChecks('permissionChange');
        }
      });
      this.permissionListenerReady = true;
    }

    const user = this.oneSignalInstance.User;
    if (!this.userListenerReady && user?.addEventListener) {
      user.addEventListener('change', async () => {
        this.updateOneSignalSubscriptionState();
        this.checkPermissionStatus();

        if (this.getUserId() && !this.isOptedOut()) {
          await this.saveCurrentSubscription('User.change');
          if (this.hasOneSignalSubscriptionId() && !this.isLinkedToCurrentUser()) {
            await this.relinkCurrentSubscription('User.change');
          }
        }
      });
      this.userListenerReady = true;
    }

    const pushSubscription = this.oneSignalInstance.User?.PushSubscription;
    if (!this.subscriptionListenerReady && pushSubscription?.addEventListener) {
      pushSubscription.addEventListener('change', async (event: any) => {
        const current = event?.current;
        this.updateOneSignalSubscriptionState(current
          ? {
              onesignalId: this.oneSignalInstance?.User?.onesignalId ?? null,
              externalId: this.oneSignalInstance?.User?.externalId ?? null,
              id: current.id ?? null,
              token: current.token ?? null,
              optedIn: current.optedIn === true,
            }
          : undefined);
        this.checkPermissionStatus();

        if (this.getUserId() && current?.optedIn === true && !this.isOptedOut()) {
          await this.loginUser();
          await this.saveCurrentSubscription('PushSubscription.change');
          await this.relinkCurrentSubscription('PushSubscription.change');
          this.scheduleSubscriptionRelinkChecks('PushSubscription.change');
        }
      });
      this.subscriptionListenerReady = true;
    }
  }

  private setupLifecycleSyncListeners(): void {
    if (!isPlatformBrowser(this.platformId) || this.lifecycleListenerReady) return;

    const syncVisibleSession = () => {
      if (document.visibilityState === 'visible' && this.getUserId() && !this.isOptedOut()) {
        void this.relinkCurrentSubscription('app-visible');
        void this.saveCurrentSubscription('app-visible');
      }
    };

    document.addEventListener('visibilitychange', syncVisibleSession);
    window.addEventListener('focus', syncVisibleSession);
    this.lifecycleListenerReady = true;
  }

  /**
   * Desvincula el dispositivo del usuario al cerrar sesión.
   */
  async removeToken(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    try {
      this.updateOneSignalSubscriptionState();
      await this.saveCurrentSubscription('removeToken', false);

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

    return (
      this.oneSignalReady &&
      this.hasRegisteredOneSignalSubscription()
    );
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
      this.updateOneSignalSubscriptionState();
      await this.saveCurrentSubscription('optOutNotifications', false);
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
    this.checkPermissionStatus();
    void this.logPushActivation(
      'activation_started',
      'info',
      'Usuario inicia activacion de notificaciones',
    );

    try {
      // If permission already granted, just login again
      if (this._permissionStatus.value === 'granted') {
        await this.ensureInitialized();
        await this.loginUser();
        const enabled = await this.ensurePushSubscriptionActive();
        await this.saveCurrentSubscription('optInNotifications');
        this.scheduleSubscriptionRelinkChecks('optInNotifications');
        void this.logPushActivation(
          enabled ? 'activation_success' : 'activation_failed',
          enabled ? 'info' : 'warn',
          enabled
            ? 'Notificaciones activadas correctamente'
            : 'No se pudo completar la activacion con permiso ya concedido',
          { permission_already_granted: true },
        );
        return enabled;
      }

      // Otherwise, request permission
      const enabled = await this.requestPermission();
      void this.logPushActivation(
        enabled ? 'activation_success' : 'activation_failed',
        enabled ? 'info' : 'warn',
        enabled
          ? 'Notificaciones activadas correctamente'
          : 'No se pudo completar la activacion tras pedir permiso',
        { permission_already_granted: false },
      );
      return enabled;
    } catch (error) {
      void this.logPushActivation(
        'activation_exception',
        'error',
        'Excepcion activando notificaciones',
        { error: this.serializeError(error) },
      );
      throw error;
    }
  }
}
