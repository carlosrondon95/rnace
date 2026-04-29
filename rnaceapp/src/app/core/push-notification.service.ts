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

type PushActivationBlocker =
  | 'unsupported_browser'
  | 'insecure_origin'
  | 'ios_not_standalone'
  | 'onesignal_not_supported';

// Declaración global del SDK de OneSignal (cargado desde index.html)
declare global {
  interface Window {
    OneSignalDeferred: Array<(OneSignal: any) => void>;
    OneSignalInitPromise?: Promise<any>;
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
  private readonly activationFlowTimeoutMs = 45000;
  private readonly serviceWorkerReadyTimeoutMs = 8000;
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
  private activationPromise: Promise<boolean> | null = null;

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
        this.isSecureOrigin() &&
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
      this.oneSignalReady = false;
      this.oneSignalInstance = null;
      this.initPromise = null;
      throw error;
    }
  }

  private isSecureOrigin(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;

    return (
      window.isSecureContext ||
      window.location.protocol === 'https:' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
    );
  }

  private isIOSDevice(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  private isStandaloneDisplayMode(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;

    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      ('standalone' in navigator && (navigator as any).standalone === true)
    );
  }

  private getActivationBlocker(): PushActivationBlocker | null {
    if (!this.isSecureOrigin()) return 'insecure_origin';
    if (this.isIOSDevice() && !this.isStandaloneDisplayMode()) return 'ios_not_standalone';
    if (!this.isSupported()) return 'unsupported_browser';

    try {
      if (
        this.oneSignalInstance?.Notifications?.isPushSupported &&
        !this.oneSignalInstance.Notifications.isPushSupported()
      ) {
        return 'onesignal_not_supported';
      }
    } catch (error) {
      console.warn('[Push] No se pudo comprobar soporte OneSignal:', error);
    }

    return null;
  }

  canAttemptPushActivation(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    return this.getActivationBlocker() === null;
  }

  private getActivationBlockerMessage(blocker: PushActivationBlocker): string {
    const browserName = this.getBrowserName();

    switch (blocker) {
      case 'insecure_origin':
        return 'Las notificaciones push solo funcionan con HTTPS. Abre RNACE desde https://centrornace.com.';
      case 'ios_not_standalone':
        return 'En iPhone, abre RNACE desde el icono de la pantalla de inicio. Safari/Chrome no pueden activar push desde una pestana normal.';
      case 'onesignal_not_supported':
        return `OneSignal indica que ${browserName} no puede crear una suscripcion push en este dispositivo. Prueba con Chrome, Edge, Safari compatible o revisa los ajustes del navegador.`;
      case 'unsupported_browser':
      default:
        return 'Este navegador no permite notificaciones push. Prueba con Chrome, Edge, Firefox o Safari compatible.';
    }
  }

  private async runActivationPrechecks(contexto: string): Promise<boolean> {
    const blocker = this.getActivationBlocker();
    if (!blocker) return true;

    const message = this.getActivationBlockerMessage(blocker);
    console.warn(`[Push] ${contexto}: precheck de activacion fallido`, {
      reason: blocker,
      message,
    });
    void this.logPushActivation(
      'activation_precheck_failed',
      'warn',
      message,
      {
        contexto,
        reason: blocker,
        diagnostics: await this.getBrowserPushDiagnostics(),
      },
    );
    return false;
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
  private async waitForOneSignal(): Promise<void> {
    const initPromise = window.OneSignalInitPromise;

    if (initPromise) {
      const OneSignal = await this.withTimeout(
        initPromise,
        this.sdkReadyTimeoutMs,
        `OneSignal.init() no completo tras ${this.sdkReadyTimeoutMs / 1000}s`,
      );
      console.log('[Push] OneSignal init listo');
      this.oneSignalInstance = OneSignal;
      return;
    }

    const OneSignal = await this.withTimeout(
      new Promise<any>((resolve) => {
        window.OneSignalDeferred = window.OneSignalDeferred || [];
        window.OneSignalDeferred.push(async (sdk: any) => {
          resolve(sdk);
        });
      }),
      this.sdkReadyTimeoutMs,
      `OneSignal SDK no estuvo listo tras ${this.sdkReadyTimeoutMs / 1000}s`,
    );

    console.log('[Push] OneSignal SDK listo');
    this.oneSignalInstance = OneSignal;
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

  private async getBrowserPushDiagnostics(): Promise<Record<string, any>> {
    if (!isPlatformBrowser(this.platformId)) return {};

    const diagnostics: Record<string, any> = {
      origin: window.location.origin,
      secure_context: window.isSecureContext,
      notification_permission: 'Notification' in window ? Notification.permission : 'unsupported',
      service_worker_supported: 'serviceWorker' in navigator,
      push_manager_supported: 'PushManager' in window,
      ios: this.isIOSDevice(),
      browser: this.getBrowserName(),
      standalone: this.isStandaloneDisplayMode(),
      visibility_state: document.visibilityState,
      cookies_enabled: navigator.cookieEnabled,
    };

    try {
      diagnostics['onesignal_push_supported'] =
        this.oneSignalInstance?.Notifications?.isPushSupported
          ? Boolean(this.oneSignalInstance.Notifications.isPushSupported())
          : null;
    } catch (error) {
      diagnostics['onesignal_push_supported_error'] = this.serializeError(error);
    }

    if (!('serviceWorker' in navigator)) {
      return diagnostics;
    }

    try {
      diagnostics['service_worker_controller'] = navigator.serviceWorker.controller?.scriptURL ?? null;
      const registrations = await navigator.serviceWorker.getRegistrations();
      diagnostics['service_workers'] = registrations.map((registration) => ({
        scope: registration.scope,
        active: registration.active?.scriptURL ?? null,
        waiting: registration.waiting?.scriptURL ?? null,
        installing: registration.installing?.scriptURL ?? null,
      }));

      const rootScope = `${window.location.origin}/`;
      const rootRegistration =
        registrations.find((registration) => registration.scope === rootScope) ||
        await navigator.serviceWorker.getRegistration('/');

      diagnostics['root_service_worker'] = rootRegistration
        ? {
            scope: rootRegistration.scope,
            active: rootRegistration.active?.scriptURL ?? null,
            waiting: rootRegistration.waiting?.scriptURL ?? null,
            installing: rootRegistration.installing?.scriptURL ?? null,
          }
        : null;

      if (rootRegistration?.pushManager) {
        const nativeSubscription = await rootRegistration.pushManager.getSubscription();
        const serialized = nativeSubscription?.toJSON();

        diagnostics['native_push_subscription'] = Boolean(nativeSubscription);
        diagnostics['native_push_endpoint'] = Boolean(serialized?.endpoint);
        diagnostics['native_push_keys'] = serialized?.keys ? Object.keys(serialized.keys) : [];
      } else {
        diagnostics['native_push_subscription'] = false;
      }
    } catch (error) {
      diagnostics['service_worker_error'] = this.serializeError(error);
    }

    return diagnostics;
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
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (this.oneSignalInstance) {
          // Usar la referencia directa al SDK (más fiable)
          await this.withTimeout(
            Promise.resolve(this.oneSignalInstance.login(usuarioId)),
            this.oneSignalLoginTimeoutMs,
            `OneSignal.login() timeout (${this.oneSignalLoginTimeoutMs / 1000}s)`,
          );
          const linked = await this.waitForExternalId(usuarioId);
          this.updateOneSignalSubscriptionState();
          if (!linked) {
            throw new Error('OneSignal.login() completo pero external_id no coincide');
          }
          await this.saveCurrentSubscription('doOneSignalLogin');
          console.log(`[Push] OneSignal.login() exitoso para usuario_id: ${usuarioId} (intento ${attempt})`);
          return true;
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
          const linked = await this.waitForExternalId(usuarioId);
          this.updateOneSignalSubscriptionState();
          if (!linked) {
            throw new Error('OneSignal.login() deferred completo pero external_id no coincide');
          }
          await this.saveCurrentSubscription('doOneSignalLogin-deferred');
          return true;
        }
      } catch (error) {
        lastError = this.serializeError(error);
        console.error(`[Push] Error en OneSignal.login() intento ${attempt}/${MAX_RETRIES}:`, error);
        if (attempt < MAX_RETRIES) {
          console.log(`[Push] Reintentando en ${RETRY_DELAY_MS}ms...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    }
    console.error(`[Push] OneSignal.login() fallo despues de ${MAX_RETRIES} intentos para usuario_id: ${usuarioId}`);
    this.updateOneSignalSubscriptionState();
    void this.logPushActivation(
      'onesignal_login_failed',
      'warn',
      'OneSignal.login no vinculo el external_id del usuario',
      {
        expected_external_id: usuarioId,
        current_external_id: this._oneSignalSubscription.value.externalId,
        error: lastError,
      },
    );
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
      const promptTimeoutMessage =
        `OneSignal.Notifications.requestPermission() timeout (${this.permissionPromptTimeoutMs / 1000}s)`;
      try {
        await this.withTimeout(
          Promise.resolve(oneSignalRequestPermission.call(this.oneSignalInstance.Notifications)),
          this.permissionPromptTimeoutMs,
          promptTimeoutMessage,
        );
        this.checkPermissionStatus();
        return await this.waitForPermissionDecision();
      } catch (error) {
        const serializedError = this.serializeError(error);
        if (serializedError === promptTimeoutMessage) {
          console.warn('[Push] OneSignal requestPermission no completo a tiempo:', error);
          void this.logPushActivation(
            'permission_prompt_timeout',
            'warn',
            'El prompt nativo de notificaciones no completo a tiempo',
            { error: serializedError },
          );
          this.checkPermissionStatus();
          return this._permissionStatus.value;
        }
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

  private isOneSignalServiceWorker(registration: ServiceWorkerRegistration): boolean {
    const scriptUrl =
      registration.active?.scriptURL ||
      registration.waiting?.scriptURL ||
      registration.installing?.scriptURL ||
      '';

    return (
      registration.scope === `${window.location.origin}/` &&
      scriptUrl.includes('/OneSignalSDKWorker.js')
    );
  }

  private async ensureOneSignalServiceWorkerReady(contexto: string): Promise<boolean> {
    if (!('serviceWorker' in navigator)) return false;

    try {
      const readyRegistration = await this.withTimeout(
        navigator.serviceWorker.ready,
        this.serviceWorkerReadyTimeoutMs,
        `Service worker no activo tras ${this.serviceWorkerReadyTimeoutMs / 1000}s`,
      );

      const registrations = await navigator.serviceWorker.getRegistrations();
      const oneSignalRegistration =
        registrations.find((registration) => this.isOneSignalServiceWorker(registration)) ||
        (this.isOneSignalServiceWorker(readyRegistration) ? readyRegistration : null);

      if (oneSignalRegistration?.active) {
        return true;
      }

      void this.logPushActivation(
        'service_worker_not_ready',
        'warn',
        'El service worker de OneSignal no esta activo',
        {
          contexto,
          diagnostics: await this.getBrowserPushDiagnostics(),
        },
      );
      return false;
    } catch (error) {
      console.warn(`[Push] ${contexto}: service worker de OneSignal no listo`, error);
      void this.logPushActivation(
        'service_worker_not_ready',
        'warn',
        'El service worker de OneSignal no quedo listo a tiempo',
        {
          contexto,
          error: this.serializeError(error),
          diagnostics: await this.getBrowserPushDiagnostics(),
        },
      );
      return false;
    }
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
    if (!await this.runActivationPrechecks(contexto)) {
      return false;
    }

    if (!await this.ensureOneSignalServiceWorkerReady(contexto)) {
      return false;
    }

    const pushSubscription = this.oneSignalInstance?.User?.PushSubscription;

    if (!pushSubscription?.optIn) {
      this.updateOneSignalSubscriptionState();
      console.warn(`[Push] ${contexto}: OneSignal.User.PushSubscription.optIn no esta disponible`);
      return this.hasRegisteredOneSignalSubscription();
    }

    const optInTimeoutMessage =
      `OneSignal.PushSubscription.optIn() timeout (${this.oneSignalOptInTimeoutMs / 1000}s)`;
    const optInPromise = Promise.resolve().then(() => pushSubscription.optIn());
    try {
      await this.withTimeout(
        optInPromise,
        this.oneSignalOptInTimeoutMs,
        optInTimeoutMessage,
      );
    } catch (error) {
      const serializedError = this.serializeError(error);
      console.warn(`[Push] ${contexto}: OneSignal optIn no completo a tiempo`, error);
      if (serializedError === optInTimeoutMessage) {
        this.watchLateOptInCompletion(optInPromise, contexto);
      }
      void this.logPushActivation(
        'optin_timeout',
        'warn',
        'OneSignal optIn no completo a tiempo',
        {
          contexto,
          error: serializedError,
          diagnostics: await this.getBrowserPushDiagnostics(),
        },
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
        {
          contexto,
          diagnostics: await this.getBrowserPushDiagnostics(),
        },
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
    if (!isPlatformBrowser(this.platformId)) return false;

    if (!await this.runActivationPrechecks('requestPermission')) {
      return false;
    }

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
      if (!await this.runActivationPrechecks('requestPermission-after-init')) {
        return false;
      }
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
        const { data, error } = await this.withTimeout(
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

        if (data?.success === false) {
          console.warn(`[Push] ${contexto}: register-push-subscription respondio success=false`, data);
          void this.logPushActivation(
            'register_subscription_rejected',
            'error',
            'Supabase rechazo el registro de la subscription',
            { contexto, error: data.error ?? 'success=false' },
          );
          return false;
        }

        if (data?.onesignal_linked === false) {
          void this.logPushActivation(
            data.link_skipped ? 'register_subscription_link_skipped' : 'register_subscription_link_failed',
            data.link_skipped ? 'warn' : 'error',
            data.link_skipped
              ? 'Subscription guardada, pero no se intento vincular en OneSignal'
              : 'Subscription guardada, pero OneSignal no la vinculo con external_id',
            {
              contexto,
              link_skipped: data.link_skipped === true,
            },
          );
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

  getActivationFailureMessage(): string {
    if (!isPlatformBrowser(this.platformId)) {
      return 'No se pudo activar desde este entorno.';
    }

    this.checkPermissionStatus();
    this.updateOneSignalSubscriptionState();

    const browserName = this.getBrowserName();
    const permission = this._permissionStatus.value;
    const state = this._oneSignalSubscription.value;

    const blocker = this.getActivationBlocker();
    if (blocker) {
      return this.getActivationBlockerMessage(blocker);
    }

    if (!this.isSupported()) {
      return `Este navegador no permite notificaciones push. Prueba con Chrome, Edge, Firefox o Safari compatible.`;
    }

    if (permission === 'denied') {
      return `Las notificaciones estan bloqueadas. Activalas para RNACE y tambien para ${browserName} en los ajustes del dispositivo.`;
    }

    if (permission === 'default') {
      return `El navegador no ha mostrado o aceptado el permiso. Revisa que ${browserName} permita pedir notificaciones y vuelve a pulsar Activar.`;
    }

    if (!this.oneSignalReady) {
      return 'OneSignal no ha terminado de cargar. Cierra la app por completo y abrela de nuevo.';
    }

    if (!state.id && !state.token) {
      return `El permiso esta concedido, pero ${browserName} no ha creado la suscripcion push. Activa las notificaciones de ${browserName} en los ajustes del dispositivo y vuelve a intentarlo.`;
    }

    if (!state.optedIn) {
      return 'El permiso esta concedido, pero esta suscripcion sigue desactivada en OneSignal. Vuelve a pulsar Activar en unos segundos.';
    }

    if (!this.isLinkedToCurrentUser(state)) {
      return 'La suscripcion push existe, pero no se ha vinculado con tu usuario. Cierra sesion, entra de nuevo y pulsa Activar.';
    }

    return 'No se pudo completar la activacion. Revisa los ajustes de notificaciones del navegador y vuelve a intentarlo.';
  }

  private getBrowserName(): string {
    if (!isPlatformBrowser(this.platformId)) return 'el navegador';

    const ua = navigator.userAgent;

    if (/Edg\//.test(ua)) return 'Edge';
    if (/OPR\//.test(ua) || /Opera/.test(ua)) return 'Opera';
    if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
    if (/CriOS\//.test(ua) || /Chrome\//.test(ua)) return 'Chrome';
    if (/Firefox\//.test(ua) || /FxiOS\//.test(ua)) return 'Firefox';
    if (/Safari\//.test(ua)) return 'Safari';

    return 'el navegador';
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

    if (!this.activationPromise) {
      this.activationPromise = this.optInNotificationsOnce().finally(() => {
        this.activationPromise = null;
      });
    }

    try {
      return await this.withTimeout(
        this.activationPromise,
        this.activationFlowTimeoutMs,
        `Activacion push timeout (${this.activationFlowTimeoutMs / 1000}s)`,
      );
    } catch (error) {
      const serializedError = this.serializeError(error);
      if (serializedError === `Activacion push timeout (${this.activationFlowTimeoutMs / 1000}s)`) {
        console.warn('[Push] Activacion no completo a tiempo:', error);
        this.checkPermissionStatus();
        this.updateOneSignalSubscriptionState();
        void this.logPushActivation(
          'activation_timeout',
          'warn',
          'La activacion push no completo a tiempo',
          {
            error: serializedError,
            diagnostics: await this.getBrowserPushDiagnostics(),
          },
        );
        return this.isEffectivelyEnabled();
      }

      throw error;
    }
  }

  private async optInNotificationsOnce(): Promise<boolean> {
    localStorage.removeItem('rnace_push_optout');
    this.checkPermissionStatus();
    void this.logPushActivation(
      'activation_started',
      'info',
      'Usuario inicia activacion de notificaciones',
    );

    try {
      if (!await this.runActivationPrechecks('optInNotifications')) {
        return false;
      }

      // If permission already granted, just login again
      if (this._permissionStatus.value === 'granted') {
        await this.ensureInitialized();
        if (!await this.runActivationPrechecks('optInNotifications-after-init')) {
          return false;
        }
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
