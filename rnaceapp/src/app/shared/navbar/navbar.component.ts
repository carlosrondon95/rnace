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
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.scss',
})
export class NavbarComponent implements OnInit, OnDestroy {
  private auth = inject(AuthService);
  private router = inject(Router);

  menuAbierto = signal(false);
  mostrarNavbar = signal(true);
  notificacionesNoLeidas = signal(0);

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastScrollY = 0;
  private scrollThreshold = 60;

  estaLogueado = () => this.auth.estaLogueado();

  isCliente = computed(() => this.auth.usuario()?.rol === 'cliente');
  isProfesor = computed(() => this.auth.usuario()?.rol === 'profesor');
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

    if (typeof window !== 'undefined') {
      window.addEventListener('scroll', this.onScroll.bind(this), { passive: true });
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

    // Solo ocultar si scroll hacia abajo y pasamos el threshold
    if (currentScrollY > this.lastScrollY && currentScrollY > this.scrollThreshold) {
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
    this.cerrarMenu();
    this.router.navigateByUrl('/notificaciones');
  }

  cerrarSesion() {
    this.cerrarMenu();
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}
