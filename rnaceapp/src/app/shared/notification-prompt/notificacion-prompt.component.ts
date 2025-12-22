import { Component, inject, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PushNotificationService } from '../../core/push-notification.service';
import { InstallPromptService } from '../../core/install-prompt.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-notification-prompt',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- Prompt de instalación PWA -->
    @if (showInstallPrompt() && !isInstalled()) {
      <div class="prompt-card">
        <div class="prompt-icon prompt-icon--install">
          <span class="material-symbols-rounded">download</span>
        </div>
        <div class="prompt-content">
          <h4>Instalar RNACE</h4>
          <p>Añade la app a tu pantalla de inicio</p>
        </div>
        <div class="prompt-actions">
          <button class="btn-dismiss" (click)="dismissInstall()">
            <span class="material-symbols-rounded">close</span>
          </button>
          <button class="btn-primary" (click)="installApp()">
            Instalar
          </button>
        </div>
      </div>
    }

    <!-- Instrucciones iOS -->
    @if (showIOSInstructions() && isIOS() && !isInstalled()) {
      <div class="prompt-card prompt-card--ios">
        <div class="prompt-icon prompt-icon--ios">
          <span class="material-symbols-rounded">smartphone</span>
        </div>
        <div class="prompt-content">
          <h4>Instalar en iPhone</h4>
          <div class="ios-steps">
            @for (step of iosSteps; track $index) {
              <p>{{ $index + 1 }}. {{ step }}</p>
            }
          </div>
        </div>
        <button class="btn-dismiss" (click)="dismissIOS()">
          <span class="material-symbols-rounded">close</span>
        </button>
      </div>
    }

    <!-- Prompt de notificaciones -->
    @if (showNotificationPrompt() && isSupported()) {
      <div class="prompt-card">
        <div class="prompt-icon prompt-icon--notification">
          <span class="material-symbols-rounded">notifications</span>
        </div>
        <div class="prompt-content">
          <h4>Activar notificaciones</h4>
          <p>Recibe avisos de reservas y plazas</p>
        </div>
        <div class="prompt-actions">
          <button class="btn-dismiss" (click)="dismissNotifications()">
            <span class="material-symbols-rounded">close</span>
          </button>
          <button class="btn-primary" (click)="enableNotifications()" [disabled]="requesting()">
            {{ requesting() ? 'Activando...' : 'Activar' }}
          </button>
        </div>
      </div>
    }

    <!-- Badge de éxito -->
    @if (permissionGranted() && showSuccess()) {
      <div class="status-badge status-badge--success">
        <span class="material-symbols-rounded">check_circle</span>
        Notificaciones activadas
      </div>
    }

    <!-- Badge de denegado -->
    @if (permissionDenied()) {
      <div class="status-badge status-badge--denied">
        <span class="material-symbols-rounded">notifications_off</span>
        Notificaciones bloqueadas
        <button class="btn-info" (click)="showHelpModal.set(true)">
          <span class="material-symbols-rounded">help</span>
        </button>
      </div>
    }

    <!-- Modal de ayuda -->
    @if (showHelpModal()) {
      <div class="modal-overlay" (click)="showHelpModal.set(false)">
        <div class="modal-content" (click)="$event.stopPropagation()">
          <h3>Cómo activar notificaciones</h3>
          <p>Las notificaciones están bloqueadas. Para activarlas:</p>
          <ol>
            <li>Abre la configuración de tu navegador</li>
            <li>Busca "Permisos" o "Notificaciones"</li>
            <li>Encuentra RNACE y cambia a "Permitir"</li>
            <li>Recarga la página</li>
          </ol>
          <button class="btn-primary btn-full" (click)="showHelpModal.set(false)">
            Entendido
          </button>
        </div>
      </div>
    }
  `,
  styles: [`
    :host {
      display: block;
    }

    .prompt-card {
      display: flex;
      align-items: flex-start;
      gap: var(--space-md);
      padding: var(--space-md);
      margin-bottom: var(--space-md);
      background: var(--color-bg-elevated);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      animation: slideDown 0.3s ease-out;
    }

    @keyframes slideDown {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .prompt-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: var(--radius-md);
      flex-shrink: 0;

      .material-symbols-rounded {
        font-size: 1.5rem;
      }

      &--install {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
      }

      &--ios {
        background: linear-gradient(135deg, #1a1a2e 0%, #434343 100%);
        color: white;
      }

      &--notification {
        background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        color: white;
      }
    }

    .prompt-content {
      flex: 1;
      min-width: 0;

      h4 {
        margin: 0 0 4px;
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: var(--color-text-primary);
      }

      p {
        margin: 0;
        font-size: var(--font-size-xs);
        color: var(--color-text-muted);
      }
    }

    .ios-steps p {
      margin: 4px 0;
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
    }

    .prompt-actions {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      flex-shrink: 0;
    }

    .btn-primary {
      padding: var(--space-sm) var(--space-md);
      background: var(--color-accent);
      color: var(--color-bg-deep);
      border: none;
      border-radius: var(--radius-md);
      font-size: var(--font-size-sm);
      font-weight: 500;
      cursor: pointer;
      transition: opacity var(--transition-fast);

      &:hover:not(:disabled) {
        opacity: 0.9;
      }

      &:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      &.btn-full {
        width: 100%;
      }
    }

    .btn-dismiss {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      background: transparent;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      color: var(--color-text-muted);
      cursor: pointer;
      transition: all var(--transition-fast);

      .material-symbols-rounded {
        font-size: 1.25rem;
      }

      &:hover {
        background: var(--color-bg-main);
        color: var(--color-text-secondary);
      }
    }

    .btn-info {
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: none;
      color: inherit;
      cursor: pointer;
      opacity: 0.7;

      &:hover {
        opacity: 1;
      }

      .material-symbols-rounded {
        font-size: 1rem;
      }
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: var(--space-sm);
      padding: var(--space-sm) var(--space-md);
      border-radius: var(--radius-full);
      font-size: var(--font-size-xs);
      font-weight: 500;
      margin-bottom: var(--space-md);

      .material-symbols-rounded {
        font-size: 1rem;
      }

      &--success {
        background: rgba(74, 222, 128, 0.15);
        color: var(--color-success, #22c55e);
      }

      &--denied {
        background: rgba(248, 113, 113, 0.15);
        color: var(--color-danger);
      }
    }

    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: var(--space-md);
    }

    .modal-content {
      background: var(--color-bg-elevated);
      padding: var(--space-lg);
      border-radius: var(--radius-lg);
      max-width: 360px;
      width: 100%;

      h3 {
        margin: 0 0 var(--space-sm);
        font-size: var(--font-size-md);
        color: var(--color-text-primary);
      }

      p {
        margin: 0 0 var(--space-md);
        font-size: var(--font-size-sm);
        color: var(--color-text-muted);
      }

      ol {
        margin: 0 0 var(--space-lg);
        padding-left: var(--space-lg);

        li {
          margin-bottom: var(--space-sm);
          font-size: var(--font-size-sm);
          color: var(--color-text-secondary);
        }
      }
    }

    @media (max-width: 480px) {
      .prompt-card {
        flex-wrap: wrap;
      }

      .prompt-actions {
        width: 100%;
        justify-content: flex-end;
        margin-top: var(--space-sm);
        padding-top: var(--space-sm);
        border-top: 1px solid var(--color-border);
      }
    }
  `]
})
export class NotificationPromptComponent implements OnInit, OnDestroy {
  private pushService = inject(PushNotificationService);
  private installService = inject(InstallPromptService);
  private subscriptions: Subscription[] = [];

  // Signals
  showInstallPrompt = signal(false);
  showIOSInstructions = signal(false);
  showNotificationPrompt = signal(false);
  showSuccess = signal(false);
  showHelpModal = signal(false);
  requesting = signal(false);

  isInstalled = signal(false);
  isIOS = signal(false);
  isSupported = signal(false);
  permissionGranted = signal(false);
  permissionDenied = signal(false);

  iosSteps: string[] = [];

  ngOnInit(): void {
    this.iosSteps = this.installService.getIOSInstructions();
    this.setupSubscriptions();
    this.checkInitialState();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(s => s.unsubscribe());
  }

  private setupSubscriptions(): void {
    this.subscriptions.push(
      this.installService.canInstall$.subscribe((can: boolean) => {
        this.showInstallPrompt.set(can && !this.isDismissed('install'));
      }),
      this.installService.isInstalled$.subscribe((installed: boolean) => {
        this.isInstalled.set(installed);
      }),
      this.installService.isIOS$.subscribe((ios: boolean) => {
        this.isIOS.set(ios);
        if (ios && !this.installService.isInstalled() && !this.isDismissed('ios')) {
          this.showIOSInstructions.set(true);
        }
      }),
      this.pushService.isSupported$.subscribe((supported: boolean) => {
        this.isSupported.set(supported);
      }),
      this.pushService.permissionStatus$.subscribe((status: NotificationPermission) => {
        this.permissionGranted.set(status === 'granted');
        this.permissionDenied.set(status === 'denied');
        this.showNotificationPrompt.set(
          status === 'default' && 
          this.pushService.isSupported() && 
          !this.isDismissed('notification')
        );
      })
    );
  }

  private checkInitialState(): void {
    const status = this.pushService.getPermissionStatus();
    this.permissionGranted.set(status === 'granted');
    this.permissionDenied.set(status === 'denied');
  }

  async installApp(): Promise<void> {
    await this.installService.promptInstall();
  }

  dismissInstall(): void {
    this.showInstallPrompt.set(false);
    sessionStorage.setItem('dismiss_install', 'true');
  }

  dismissIOS(): void {
    this.showIOSInstructions.set(false);
    sessionStorage.setItem('dismiss_ios', 'true');
  }

  async enableNotifications(): Promise<void> {
    this.requesting.set(true);
    try {
      const success = await this.pushService.requestPermission();
      if (success) {
        this.showNotificationPrompt.set(false);
        this.showSuccess.set(true);
        setTimeout(() => this.showSuccess.set(false), 5000);
      }
    } finally {
      this.requesting.set(false);
    }
  }

  dismissNotifications(): void {
    this.showNotificationPrompt.set(false);
    sessionStorage.setItem('dismiss_notification', 'true');
  }

  private isDismissed(key: string): boolean {
    return sessionStorage.getItem(`dismiss_${key}`) === 'true';
  }
}