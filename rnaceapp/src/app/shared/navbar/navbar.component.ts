// src/app/shared/navbar/navbar.component.ts
import { CommonModule } from '@angular/common';
import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { supabase } from '../../core/supabase.client';

@Component({
  standalone: true,
  selector: 'app-navbar',
  imports: [CommonModule, RouterLink, RouterLinkActive],
  template: `
    <nav class="navbar" [class.navbar--hidden]="!mostrarNavbar()">
      <div class="navbar-container">
        <!-- Logo -->
        <a routerLink="/dashboard" class="navbar-logo">
          <img src="assets/img/logo.png" alt="Logo" class="logo-img" />
        </a>

        <!-- Links centro (desktop) -->
        @if (estaLogueado()) {
          <div class="navbar-links">
            @if (isCliente()) {
              <a routerLink="/calendario" routerLinkActive="active" class="nav-link">
                Mis clases
              </a>
              <a routerLink="/recuperar-clase" routerLinkActive="active" class="nav-link">
                Recuperar
              </a>
            }

            @if (isAdmin()) {
              <a routerLink="/calendario" routerLinkActive="active" class="nav-link">
                Calendario
              </a>
              <a routerLink="/gestionar-perfiles" routerLinkActive="active" class="nav-link">
                Perfiles
              </a>
              <a routerLink="/lista-espera" routerLinkActive="active" class="nav-link"> Espera </a>
            }
          </div>
        }

        <!-- Acciones derecha -->
        <div class="navbar-actions">
          @if (estaLogueado()) {
            <!-- Botón notificaciones -->
            <button
              type="button"
              class="btn-notif"
              (click)="irANotificaciones()"
              aria-label="Ver notificaciones"
            >
              <span class="material-symbols-rounded">notifications</span>
              @if (notificacionesNoLeidas() > 0) {
                <span class="notif-badge">{{ notificacionesNoLeidas() }}</span>
              }
            </button>

            <!-- Menú usuario -->
            <div class="user-menu">
              <button
                type="button"
                class="btn-user"
                (click)="toggleMenu()"
                [attr.aria-expanded]="menuAbierto()"
                aria-label="Menú de usuario"
              >
                <span class="user-avatar">
                  {{ iniciales() }}
                </span>
                <span class="material-symbols-rounded icon-chevron"> expand_more </span>
              </button>

              @if (menuAbierto()) {
                <div class="dropdown-menu" role="menu">
                  <div class="dropdown-header">
                    <span class="dropdown-name">{{ nombreUsuario() }}</span>
                    <span class="dropdown-role">{{ rolLabel() }}</span>
                  </div>
                  <div class="dropdown-divider"></div>
                  <button
                    type="button"
                    class="dropdown-item"
                    (click)="cerrarSesion()"
                    role="menuitem"
                  >
                    <span class="material-symbols-rounded">logout</span>
                    Cerrar sesión
                  </button>
                </div>
              }
            </div>
          } @else {
            <a routerLink="/login" class="btn-login"> Iniciar sesión </a>
          }
        </div>
      </div>
    </nav>

    <!-- Overlay para cerrar menú -->
    @if (menuAbierto()) {
      <div
        class="menu-overlay"
        (click)="cerrarMenu()"
        (keydown.escape)="cerrarMenu()"
        tabindex="-1"
      ></div>
    }
  `,
  styles: [
    `
      .navbar {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: 60px;
        background: rgba(50, 51, 47, 0.95);
        backdrop-filter: blur(10px);
        border-bottom: 1px solid rgba(232, 233, 227, 0.08);
        z-index: 1000;
        transition: transform 0.3s ease;
      }

      .navbar--hidden {
        transform: translateY(-100%);
      }

      .navbar-container {
        max-width: 1200px;
        height: 100%;
        margin: 0 auto;
        padding: 0 1rem;
        display: flex;
        align-items: center;
        gap: 1.5rem;
      }

      .navbar-logo {
        display: flex;
        align-items: center;
        text-decoration: none;
      }

      .logo-img {
        height: 32px;
        width: auto;
      }

      .navbar-links {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        margin-left: 1rem;
      }

      .nav-link {
        padding: 0.5rem 0.875rem;
        color: rgba(235, 233, 227, 0.7);
        text-decoration: none;
        font-size: 0.875rem;
        font-weight: 500;
        border-radius: 8px;
        transition: all 0.15s ease;

        &:hover {
          color: #ebe9e3;
          background: rgba(255, 255, 255, 0.05);
        }

        &.active {
          color: #b8b29e;
          background: rgba(184, 178, 158, 0.1);
        }
      }

      .navbar-actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-left: auto;
      }

      .btn-notif {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        background: none;
        border: none;
        border-radius: 10px;
        color: rgba(235, 233, 227, 0.7);
        cursor: pointer;
        transition: all 0.15s ease;

        &:hover {
          background: rgba(255, 255, 255, 0.08);
          color: #ebe9e3;
        }

        .material-symbols-rounded {
          font-size: 1.4rem;
        }
      }

      .notif-badge {
        position: absolute;
        top: 4px;
        right: 4px;
        min-width: 16px;
        height: 16px;
        padding: 0 4px;
        background: #ef4444;
        color: white;
        border-radius: 8px;
        font-size: 0.65rem;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .user-menu {
        position: relative;
      }

      .btn-user {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.25rem;
        background: none;
        border: none;
        border-radius: 10px;
        cursor: pointer;
        transition: background 0.15s ease;

        &:hover {
          background: rgba(255, 255, 255, 0.08);
        }
      }

      .user-avatar {
        width: 32px;
        height: 32px;
        background: linear-gradient(135deg, #b8b29e 0%, #8a8574 100%);
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.8rem;
        font-weight: 600;
        color: #32332f;
      }

      .icon-chevron {
        font-size: 1.25rem;
        color: rgba(235, 233, 227, 0.5);
        transition: transform 0.2s ease;

        .btn-user[aria-expanded='true'] & {
          transform: rotate(180deg);
        }
      }

      .dropdown-menu {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        min-width: 200px;
        background: #3a3b37;
        border: 1px solid rgba(232, 233, 227, 0.1);
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
        overflow: hidden;
        animation: dropdown-in 0.15s ease;
      }

      @keyframes dropdown-in {
        from {
          opacity: 0;
          transform: translateY(-8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .dropdown-header {
        padding: 0.875rem 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
      }

      .dropdown-name {
        font-size: 0.9rem;
        font-weight: 600;
        color: #ebe9e3;
      }

      .dropdown-role {
        font-size: 0.75rem;
        color: rgba(235, 233, 227, 0.5);
      }

      .dropdown-divider {
        height: 1px;
        background: rgba(232, 233, 227, 0.08);
      }

      .dropdown-item {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        width: 100%;
        padding: 0.75rem 1rem;
        background: none;
        border: none;
        color: rgba(235, 233, 227, 0.8);
        font-size: 0.875rem;
        cursor: pointer;
        transition: all 0.15s ease;

        &:hover {
          background: rgba(255, 255, 255, 0.05);
          color: #ebe9e3;
        }

        .material-symbols-rounded {
          font-size: 1.2rem;
        }
      }

      .menu-overlay {
        position: fixed;
        inset: 0;
        z-index: 999;
      }

      .btn-login {
        padding: 0.5rem 1rem;
        background: #b8b29e;
        color: #32332f;
        text-decoration: none;
        font-size: 0.875rem;
        font-weight: 600;
        border-radius: 8px;
        transition: opacity 0.15s ease;

        &:hover {
          opacity: 0.9;
        }
      }

      @media (max-width: 640px) {
        .navbar-links {
          display: none;
        }

        .navbar-container {
          padding: 0 0.75rem;
        }
      }
    `,
  ],
})
export class NavbarComponent implements OnInit, OnDestroy {
  private auth = inject(AuthService);
  private router = inject(Router);

  menuAbierto = signal(false);
  mostrarNavbar = signal(true);
  notificacionesNoLeidas = signal(0);

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastScrollY = 0;

  estaLogueado = () => this.auth.estaLogueado();

  isCliente = computed(() => this.auth.usuario()?.rol === 'cliente');
  isAdmin = computed(() => this.auth.usuario()?.rol === 'admin');

  nombreUsuario = computed(() => this.auth.usuario()?.nombre || 'Usuario');

  iniciales = computed(() => {
    const nombre = this.auth.usuario()?.nombre || 'U';
    return nombre
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  });

  rolLabel = computed(() => {
    const rol = this.auth.usuario()?.rol;
    if (rol === 'admin') return 'Administrador';
    if (rol === 'profesor') return 'Profesor';
    return 'Cliente';
  });

  ngOnInit() {
    if (this.estaLogueado()) {
      this.cargarNotificaciones();
      this.intervalId = setInterval(() => this.cargarNotificaciones(), 30000);
    }

    // Listener para scroll (ocultar navbar)
    if (typeof window !== 'undefined') {
      window.addEventListener('scroll', this.onScroll.bind(this));
    }
  }

  ngOnDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('scroll', this.onScroll.bind(this));
    }
  }

  onScroll() {
    const currentScrollY = window.scrollY;

    if (currentScrollY > this.lastScrollY && currentScrollY > 100) {
      this.mostrarNavbar.set(false);
    } else {
      this.mostrarNavbar.set(true);
    }

    this.lastScrollY = currentScrollY;
  }

  async cargarNotificaciones() {
    const uid = this.auth.userId();
    if (!uid) return;

    try {
      const { count } = await supabase()
        .from('notificaciones')
        .select('*', { count: 'exact', head: true })
        .eq('usuario_id', uid)
        .eq('leida', false);

      this.notificacionesNoLeidas.set(count || 0);
    } catch (err) {
      console.error('Error cargando notificaciones:', err);
    }
  }

  toggleMenu() {
    this.menuAbierto.update((v) => !v);
  }

  cerrarMenu() {
    this.menuAbierto.set(false);
  }

  irANotificaciones() {
    this.router.navigateByUrl('/notificaciones');
  }

  cerrarSesion() {
    this.cerrarMenu();
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}
