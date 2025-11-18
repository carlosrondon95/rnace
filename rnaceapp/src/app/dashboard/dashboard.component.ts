// src/app/dashboard/dashboard.component.ts
import { CommonModule } from '@angular/common';
import { Component, signal, inject } from '@angular/core';
import { Router } from '@angular/router';
import { supabase } from '../core/supabase.client';

type UserRole = 'cliente' | 'profesor' | 'admin';

@Component({
  standalone: true,
  selector: 'app-dashboard',
  imports: [CommonModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent {
  private router = inject(Router);

  // Splash de éxito al entrar (logo + cargando 2s)
  showLoginSplash = signal(true);

  // Estado de perfil/rol
  role = signal<UserRole>('cliente'); // por defecto cliente
  nombre = signal<string | null>(null);
  perfilCargando = signal(true);
  perfilError = signal<string | null>(null);

  constructor() {
    // Ocultar splash a los 2s
    setTimeout(() => {
      this.showLoginSplash.set(false);
    }, 2000);

    // Cargar perfil desde Supabase
    this.cargarPerfil();
  }

  private async cargarPerfil() {
    this.perfilCargando.set(true);
    this.perfilError.set(null);

    try {
      const client = supabase();

      // 1) Usuario autenticado
      const { data: userData, error: userError } = await client.auth.getUser();

      if (userError || !userData.user) {
        console.error('[Dashboard] Error obteniendo usuario:', userError);
        this.perfilError.set('No se ha podido obtener tu perfil.');
        this.perfilCargando.set(false);
        return;
      }

      const user = userData.user;

      // 2) Perfil en tabla perfiles
      const { data: perfil, error: perfilError } = await client
        .from('perfiles')
        .select('rol, nombre')
        .eq('id', user.id)
        .maybeSingle();

      if (perfilError) {
        console.error('[Dashboard] Error obteniendo perfil:', perfilError);
        this.perfilError.set('No se ha podido cargar tu perfil.');
        this.perfilCargando.set(false);
        return;
      }

      const rolRaw = (perfil?.rol || '').toLowerCase().trim();

      let rol: UserRole = 'cliente';
      if (rolRaw === 'profesor') rol = 'profesor';
      if (rolRaw === 'admin') rol = 'admin';

      this.role.set(rol);
      this.nombre.set(perfil?.nombre || user.email || null);
    } catch (e) {
      console.error('[Dashboard] Error inesperado cargando perfil:', e);
      this.perfilError.set('Ha ocurrido un error al cargar tu perfil.');
    } finally {
      this.perfilCargando.set(false);
    }
  }

  // ====== Handlers comunes ======

  // Cliente / Profesor → “Mis citas / Reservar cita”
  onReservaCita() {
    // De momento navegación simple; la lógica de reserva vendrá después
    this.router.navigateByUrl('/reservar-cita');
  }

  onVerCalendario() {
    console.log('Ver calendario (pendiente de implementar navegación)');
  }

  onPerfil() {
    console.log('Mi perfil (pendiente de implementar navegación)');
  }

  // ====== Handlers específicos profesor/admin ======

  onMisGrupos() {
    console.log('Mis grupos (profesor) (pendiente de implementar navegación)');
  }

  onVerCitas() {
    console.log('Ver citas (admin) (pendiente de implementar navegación)');
  }

  onVerGrupos() {
    console.log('Ver grupos (admin) (pendiente de implementar navegación)');
  }

  onGestionarPerfiles() {
    console.log(
      'Gestionar perfiles (admin) (pendiente de implementar navegación)',
    );
  }
}
  