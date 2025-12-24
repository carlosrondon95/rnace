import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

@Injectable({
  providedIn: 'root'
})
export class InstallPromptService {
  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  private _canInstall = new BehaviorSubject<boolean>(false);
  private _isInstalled = new BehaviorSubject<boolean>(false);
  private _isIOS = new BehaviorSubject<boolean>(false);

  canInstall$ = this._canInstall.asObservable();
  isInstalled$ = this._isInstalled.asObservable();
  isIOS$ = this._isIOS.asObservable();

  constructor() {
    this.detectPlatform();
    this.checkIfInstalled();
    this.listenForInstallPrompt();
    this.listenForAppInstalled();
  }

  private detectPlatform(): void {
    this._isIOS.next(/iPhone|iPad|iPod/.test(navigator.userAgent));
  }

  private checkIfInstalled(): void {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const isIOSStandalone = (window.navigator as any).standalone === true;
    this._isInstalled.next(isStandalone || isIOSStandalone);
  }

  isInstalled(): boolean {
    return this._isInstalled.value;
  }

  private listenForInstallPrompt(): void {
    window.addEventListener('beforeinstallprompt', (e) => {
      console.log('📢 [InstallPrompt] Evento beforeinstallprompt capturado!');
      e.preventDefault();
      this.deferredPrompt = e as BeforeInstallPromptEvent;
      this._canInstall.next(true);
    });
  }

  private listenForAppInstalled(): void {
    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this._canInstall.next(false);
      this._isInstalled.next(true);
    });
  }

  async promptInstall(): Promise<boolean> {
    if (!this.deferredPrompt) return false;

    try {
      await this.deferredPrompt.prompt();
      const { outcome } = await this.deferredPrompt.userChoice;
      this.deferredPrompt = null;
      this._canInstall.next(false);
      return outcome === 'accepted';
    } catch {
      return false;
    }
  }

  getIOSInstructions(): string[] {
    return [
      'Toca el botón "Compartir" (📤)',
      'Selecciona "Añadir a pantalla de inicio"',
      'Toca "Añadir"'
    ];
  }
}