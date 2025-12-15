// src/app/shared/navbar/navbar.component.ts
import { CommonModule } from '@angular/common';
import { Component, inject, signal, computed } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/auth.service';

@Component({
  standalone: true,
  selector: 'app-navbar',
  imports: [CommonModule, RouterLink, RouterLinkActive],
  template: `
    @if (estaLogueado()) {
      <header class="top-nav">
        <div class="nav-left">
          <a routerLink="/dashboard" class="nav-logo">RNACE</a>
          <span class="nav-tagline">Gestión de citas</span>
        </div>

        <nav class="nav-center">
          <!-- Cliente -->
          @if (role() === 'cliente') {
            <a routerLink="/reservar-cita" routerLinkActive="nav-link--active" class="nav-link">
              <span class="material-symbols-rounded">event_available</span>
              <span class="nav-link-text">Reservar</span>
            </a>
            <a routerLink="/calendario" routerLinkActive="nav-link--active" class="nav-link">
              <span class="material-symbols-rounded">calendar_month</span>
              <span class="nav-link-text">Mis clases</span>
            </a>
          }

          <!-- Profesor -->
          @if (role() === 'profesor') {
            <a routerLink="/calendario" routerLinkActive="nav-link--active" class="nav-link">
              <span class="material-symbols-rounded">calendar_month</span>
              <span class="nav-link-text">Calendario</span>
            </a>
          }

          <!-- Admin -->
          @if (role() === 'admin') {
            <a routerLink="/calendario" routerLinkActive="nav-link--active" class="nav-link">
              <span class="material-symbols-rounded">calendar_month</span>
              <span class="nav-link-text">Calendario</span>
            </a>
            <a
              routerLink="/gestionar-perfiles"
              routerLinkActive="nav-link--active"
              class="nav-link"
            >
              <span class="material-symbols-rounded">manage_accounts</span>
              <span class="nav-link-text">Perfiles</span>
            </a>
          }
        </nav>

        <div class="nav-right">
          <span class="nav-user">
            <span class="material-symbols-rounded">person</span>
            <span class="nav-user-name">{{ userName() }}</span>
          </span>
          <button class="nav-logout" (click)="onLogout()" title="Cerrar sesión">
            <span class="material-symbols-rounded">logout</span>
          </button>
        </div>

        <!-- Menú móvil toggle -->
        <button class="nav-mobile-toggle" (click)="toggleMobileMenu()">
          <span class="material-symbols-rounded">{{ mobileMenuOpen() ? 'close' : 'menu' }}</span>
        </button>
      </header>

      <!-- Menú móvil -->
      @if (mobileMenuOpen()) {
        <nav class="mobile-menu">
          @if (role() === 'cliente') {
            <a routerLink="/reservar-cita" class="mobile-link" (click)="closeMobileMenu()">
              <span class="material-symbols-rounded">event_available</span>
              Reservar cita
            </a>
            <a routerLink="/calendario" class="mobile-link" (click)="closeMobileMenu()">
              <span class="material-symbols-rounded">calendar_month</span>
              Mis clases
            </a>
          }

          @if (role() === 'profesor') {
            <a routerLink="/calendario" class="mobile-link" (click)="closeMobileMenu()">
              <span class="material-symbols-rounded">calendar_month</span>
              Calendario
            </a>
          }

          @if (role() === 'admin') {
            <a routerLink="/calendario" class="mobile-link" (click)="closeMobileMenu()">
              <span class="material-symbols-rounded">calendar_month</span>
              Calendario
            </a>
            <a routerLink="/gestionar-perfiles" class="mobile-link" (click)="closeMobileMenu()">
              <span class="material-symbols-rounded">manage_accounts</span>
              Gestionar perfiles
            </a>
          }

          <button class="mobile-link mobile-link--logout" (click)="onLogout()">
            <span class="material-symbols-rounded">logout</span>
            Cerrar sesión
          </button>
        </nav>
      }
    }
  `,
  styles: [
    `
      .top-nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 1.5rem;
        height: 56px;
        background: #3a3b37;
        border-bottom: 1px solid rgba(232, 233, 227, 0.1);
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 1000;
      }

      .nav-left {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .nav-logo {
        font-size: 1.2rem;
        font-weight: 700;
        color: #b8b29e;
        text-decoration: none;
        letter-spacing: 1px;

        &:hover {
          color: #ebe9e3;
        }
      }

      .nav-tagline {
        font-size: 0.7rem;
        color: rgba(235, 233, 227, 0.4);
        display: none;
        @media (min-width: 768px) {
          display: inline;
        }
      }

      .nav-center {
        display: none;
        align-items: center;
        gap: 0.25rem;
        @media (min-width: 768px) {
          display: flex;
        }
      }

      .nav-link {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.5rem 0.85rem;
        border-radius: 8px;
        color: rgba(235, 233, 227, 0.7);
        text-decoration: none;
        font-size: 0.85rem;
        font-weight: 500;
        transition: all 0.15s;

        &:hover {
          background: rgba(255, 255, 255, 0.05);
          color: #ebe9e3;
        }

        &--active {
          background: rgba(184, 178, 158, 0.15);
          color: #b8b29e;
        }

        .material-symbols-rounded {
          font-size: 1.1rem;
        }
        .nav-link-text {
          @media (max-width: 900px) {
            display: none;
          }
        }
      }

      .nav-right {
        display: none;
        align-items: center;
        gap: 0.75rem;
        @media (min-width: 768px) {
          display: flex;
        }
      }

      .nav-user {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.8rem;
        color: rgba(235, 233, 227, 0.6);

        .material-symbols-rounded {
          font-size: 1rem;
        }
        .nav-user-name {
          max-width: 120px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      }

      .nav-logout {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        background: transparent;
        border: 1px solid rgba(248, 113, 113, 0.3);
        border-radius: 8px;
        color: rgba(248, 113, 113, 0.7);
        cursor: pointer;
        transition: all 0.15s;

        &:hover {
          background: rgba(248, 113, 113, 0.1);
          border-color: rgba(248, 113, 113, 0.5);
          color: #f87171;
        }

        .material-symbols-rounded {
          font-size: 1.1rem;
        }
      }

      .nav-mobile-toggle {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        background: transparent;
        border: 1px solid rgba(232, 233, 227, 0.15);
        border-radius: 8px;
        color: rgba(235, 233, 227, 0.7);
        cursor: pointer;

        @media (min-width: 768px) {
          display: none;
        }

        &:hover {
          background: rgba(255, 255, 255, 0.05);
          color: #ebe9e3;
        }

        .material-symbols-rounded {
          font-size: 1.4rem;
        }
      }

      .mobile-menu {
        display: flex;
        flex-direction: column;
        position: fixed;
        top: 56px;
        left: 0;
        right: 0;
        background: #3a3b37;
        border-bottom: 1px solid rgba(232, 233, 227, 0.1);
        padding: 0.5rem;
        z-index: 999;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);

        @media (min-width: 768px) {
          display: none;
        }
      }

      .mobile-link {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.85rem 1rem;
        border-radius: 8px;
        color: rgba(235, 233, 227, 0.8);
        text-decoration: none;
        font-size: 0.95rem;
        background: transparent;
        border: none;
        width: 100%;
        text-align: left;
        cursor: pointer;

        &:hover {
          background: rgba(255, 255, 255, 0.05);
          color: #ebe9e3;
        }

        .material-symbols-rounded {
          font-size: 1.2rem;
        }

        &--logout {
          color: rgba(248, 113, 113, 0.8);
          margin-top: 0.5rem;
          border-top: 1px solid rgba(232, 233, 227, 0.1);
          padding-top: 1rem;
          border-radius: 0 0 8px 8px;

          &:hover {
            background: rgba(248, 113, 113, 0.1);
            color: #f87171;
          }
        }
      }
    `,
  ],
})
export class NavbarComponent {
  private router = inject(Router);
  private authService = inject(AuthService);

  mobileMenuOpen = signal(false);

  estaLogueado = computed(() => this.authService.estaLogueado());
  role = computed(() => this.authService.usuario()?.rol || 'cliente');
  userName = computed(() => this.authService.usuario()?.nombre || 'Usuario');

  toggleMobileMenu() {
    this.mobileMenuOpen.update((v) => !v);
  }

  closeMobileMenu() {
    this.mobileMenuOpen.set(false);
  }

  onLogout() {
    this.closeMobileMenu();
    this.authService.logout();
    this.router.navigateByUrl('/login');
  }
}
