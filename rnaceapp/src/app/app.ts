// src/app/app.ts
import { Component, inject, signal } from '@angular/core';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { NavbarComponent } from './shared/navbar/navbar.component';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NavbarComponent, CommonModule],
  template: `
    <app-navbar *ngIf="mostrarNavbar()" />
    <router-outlet />
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
  mostrarNavbar = signal(true);

  constructor() {
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