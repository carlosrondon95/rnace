// src/app/components/dashboard/dashboard.component.ts
import { CommonModule } from '@angular/common';
import { Component, inject, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';

@Component({
  standalone: true,
  selector: 'app-dashboard',
  imports: [CommonModule, RouterLink],
  template: `
    <main class="dashboard-page">
      <div class="dashboard-container">
        <!-- Bienvenida -->
        <header class="welcome-section">
          <h1>¡Hola, {{ nombreUsuario() }}!</h1>
          <p class="welcome-subtitle">
            @if (isCliente()) {
              ¿Qué te gustaría hacer hoy?
            } @else if (isProfesor()) {
              Panel de profesor
            } @else {
              Panel de administración
            }
          </p>
        </header>

        <!-- Acciones rápidas - Cliente -->
        @if (isCliente()) {
          <section class="actions-grid">
            <a routerLink="/reservar-cita" class="action-card action-card--primary">
              <span class="action-icon material-symbols-rounded">event_available</span>
              <div class="action-content">
                <h3>Reservar cita</h3>
                <p>Elige tu próxima clase</p>
              </div>
              <span class="action-arrow material-symbols-rounded">arrow_forward</span>
            </a>

            <a routerLink="/calendario" class="action-card">
              <span class="action-icon material-symbols-rounded">calendar_month</span>
              <div class="action-content">
                <h3>Mis clases</h3>
                <p>Ver calendario de reservas</p>
              </div>
              <span class="action-arrow material-symbols-rounded">arrow_forward</span>
            </a>
          </section>
        }

        <!-- Acciones rápidas - Profesor -->
        @if (isProfesor()) {
          <section class="actions-grid">
            <a routerLink="/calendario" class="action-card action-card--primary">
              <span class="action-icon material-symbols-rounded">calendar_month</span>
              <div class="action-content">
                <h3>Mi calendario</h3>
                <p>Ver clases programadas</p>
              </div>
              <span class="action-arrow material-symbols-rounded">arrow_forward</span>
            </a>
          </section>
        }

        <!-- Acciones rápidas - Admin -->
        @if (isAdmin()) {
          <section class="actions-grid actions-grid--admin">
            <a routerLink="/calendario" class="action-card action-card--primary">
              <span class="action-icon material-symbols-rounded">calendar_month</span>
              <div class="action-content">
                <h3>Calendario</h3>
                <p>Gestionar meses y festivos</p>
              </div>
              <span class="action-arrow material-symbols-rounded">arrow_forward</span>
            </a>

            <a routerLink="/gestionar-perfiles" class="action-card">
              <span class="action-icon material-symbols-rounded">manage_accounts</span>
              <div class="action-content">
                <h3>Gestionar perfiles</h3>
                <p>Usuarios y planes</p>
              </div>
              <span class="action-arrow material-symbols-rounded">arrow_forward</span>
            </a>

            <a routerLink="/reservar-cita" class="action-card">
              <span class="action-icon material-symbols-rounded">event_available</span>
              <div class="action-content">
                <h3>Ver reservas</h3>
                <p>Sesiones disponibles</p>
              </div>
              <span class="action-arrow material-symbols-rounded">arrow_forward</span>
            </a>
          </section>
        }

        <!-- Info del usuario -->
        <section class="user-info">
          <div class="user-info-card">
            <span class="user-info-icon material-symbols-rounded">person</span>
            <div class="user-info-content">
              <span class="user-info-label">Tu cuenta</span>
              <span class="user-info-value">{{ auth.usuario()?.telefono }}</span>
            </div>
            <span class="user-role-badge" [class]="'role-' + auth.usuario()?.rol">
              {{ auth.usuario()?.rol | titlecase }}
            </span>
          </div>
        </section>
      </div>
    </main>
  `,
  styles: [
    `
      .dashboard-page {
        min-height: 100vh;
        padding: 72px 1.5rem 2rem;
        background: radial-gradient(circle at top, #55574f 0, #494b46 45%, #32332f 100%);
      }

      .dashboard-container {
        max-width: 800px;
        margin: 0 auto;
      }

      .welcome-section {
        text-align: center;
        margin-bottom: 2.5rem;
        padding-top: 1rem;

        h1 {
          margin: 0 0 0.5rem;
          font-size: 1.8rem;
          font-weight: 600;
          color: #ebe9e3;
        }

        .welcome-subtitle {
          margin: 0;
          font-size: 1rem;
          color: rgba(235, 233, 227, 0.7);
        }
      }

      .actions-grid {
        display: grid;
        gap: 1rem;
        margin-bottom: 2rem;

        &--admin {
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        }
      }

      .action-card {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 1.25rem 1.5rem;
        background: #3a3b37;
        border: 1px solid rgba(232, 233, 227, 0.1);
        border-radius: 14px;
        text-decoration: none;
        color: #ebe9e3;
        transition: all 0.15s ease;

        &:hover {
          border-color: rgba(184, 178, 158, 0.3);
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
        }

        &--primary {
          background: linear-gradient(135deg, rgba(184, 178, 158, 0.15), rgba(184, 178, 158, 0.05));
          border-color: rgba(184, 178, 158, 0.3);

          .action-icon {
            color: #b8b29e;
          }

          &:hover {
            border-color: #b8b29e;
          }
        }
      }

      .action-icon {
        font-size: 2rem;
        color: rgba(235, 233, 227, 0.6);
      }

      .action-content {
        flex: 1;

        h3 {
          margin: 0 0 0.25rem;
          font-size: 1.05rem;
          font-weight: 600;
        }

        p {
          margin: 0;
          font-size: 0.8rem;
          color: rgba(235, 233, 227, 0.6);
        }
      }

      .action-arrow {
        font-size: 1.3rem;
        color: rgba(235, 233, 227, 0.3);
        transition: transform 0.15s ease;

        .action-card:hover & {
          transform: translateX(4px);
          color: #b8b29e;
        }
      }

      .user-info {
        margin-top: 1rem;
      }

      .user-info-card {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 1rem 1.25rem;
        background: #32332f;
        border-radius: 12px;
        border: 1px solid rgba(232, 233, 227, 0.08);
      }

      .user-info-icon {
        font-size: 1.5rem;
        color: rgba(235, 233, 227, 0.5);
      }

      .user-info-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
      }

      .user-info-label {
        font-size: 0.7rem;
        color: rgba(235, 233, 227, 0.5);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .user-info-value {
        font-size: 0.9rem;
        color: #ebe9e3;
      }

      .user-role-badge {
        padding: 0.3rem 0.7rem;
        border-radius: 6px;
        font-size: 0.7rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;

        &.role-cliente {
          background: rgba(96, 165, 250, 0.15);
          color: #60a5fa;
        }

        &.role-profesor {
          background: rgba(167, 139, 250, 0.15);
          color: #a78bfa;
        }

        &.role-admin {
          background: rgba(74, 222, 128, 0.15);
          color: #4ade80;
        }
      }

      @media (max-width: 600px) {
        .dashboard-page {
          padding: 68px 1rem 1.5rem;
        }

        .welcome-section h1 {
          font-size: 1.5rem;
        }

        .action-card {
          padding: 1rem 1.25rem;
        }

        .action-icon {
          font-size: 1.6rem;
        }
      }
    `,
  ],
})
export class DashboardComponent {
  auth = inject(AuthService);

  nombreUsuario = computed(() => this.auth.usuario()?.nombre || 'Usuario');

  isCliente = computed(() => this.auth.usuario()?.rol === 'cliente');
  isProfesor = computed(() => this.auth.usuario()?.rol === 'profesor');
  isAdmin = computed(() => this.auth.usuario()?.rol === 'admin');
}
