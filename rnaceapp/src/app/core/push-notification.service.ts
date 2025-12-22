import { Injectable } from '@angular/core';
import { initializeApp, FirebaseApp } from 'firebase/app';
import { getMessaging, getToken, onMessage, Messaging } from 'firebase/messaging';
import { BehaviorSubject } from 'rxjs';
import { environment } from '../../environments/environment';
import { supabase } from './supabase.client';

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

  constructor() {
    this.checkSupport();
    if (this._isSupported.value) {
      this.initializeFirebase();
    }
  }

  private checkSupport(): void {
    const isSupported =
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window;

    this._isSupported.next(isSupported);
  }

  isSupported(): boolean {
    return this._isSupported.value;
  }

  private initializeFirebase(): void {
    try {
      if (!environment.firebase?.apiKey) {
        console.warn('[Push] Firebase no configurado');
        return;
      }

      this.firebaseApp = initializeApp(environment.firebase);
      this.messaging = getMessaging(this.firebaseApp);
      this.setupForegroundListener();
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
    if (!this.messaging) return null;

    try {
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

      const deviceInfo = /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'iOS' :
        /Android/.test(navigator.userAgent) ? 'Android' : 'Web';

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

  private setupForegroundListener(): void {
    if (!this.messaging) return;

    onMessage(this.messaging, (payload) => {
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
}