// src/app/app.ts
import { Component, inject, signal } from '@angular/core';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { NavbarComponent } from './shared/navbar/navbar.component';
import { ConfirmationModalComponent } from './shared/confirmation-modal/confirmation-modal.component';
import { IosInstallBannerComponent } from './shared/ios-install-banner/ios-install-banner.component';
import { AuthService } from './core/auth.service';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NavbarComponent, CommonModule, ConfirmationModalComponent, IosInstallBannerComponent],
  template: `
    <app-navbar *ngIf="mostrarNavbar()" />
    <router-outlet />
    <app-confirmation-modal />
    <app-ios-install-banner />
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100vh;
    }
  `]
})
export class App {
  private router = inject(Router);
  private auth = inject(AuthService);
  mostrarNavbar = signal(true);

  constructor() {
    void this.auth.sincronizarPushSiHayUsuario();

    // Verificar ruta inicial
    this.actualizarNavbar(this.router.url);

    // Escuchar cambios de navegación
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        this.actualizarNavbar(event.urlAfterRedirects);
      });
  }

  private actualizarNavbar(url: string) {
    // Ocultar navbar en login
    this.mostrarNavbar.set(!url.includes('/login'));
  }
}
