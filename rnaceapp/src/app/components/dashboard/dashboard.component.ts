// src/app/components/dashboard/dashboard.component.ts
import { CommonModule } from '@angular/common';
import { Component, signal, inject } from '@angular/core';
import { Router } from '@angular/router';
import { supabase } from '../../core/supabase.client';

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

  showLoginSplash = signal(true);
  role = signal<UserRole>('cliente');
  nombre = signal<string | null>(null);
  perfilCargando = signal(true);
  perfilError = signal<string | null>(null);

  // DEBUG - muestra info en pantalla
  debugData = signal<string>('Cargando...');

  constructor() {
    setTimeout(() => this.showLoginSplash.set(false), 2000);
    this.cargarPerfil();
  }

  private async cargarPerfil() {
    this.perfilCargando.set(true);
    this.perfilError.set(null);
    let debug = '';

    try {
      const client = supabase();

      // 1) Usuario autenticado
      const { data: userData, error: userError } = await client.auth.getUser();

      if (userError || !userData.user) {
        debug = `ERROR AUTH: ${JSON.stringify(userError)}`;
        this.debugData.set(debug);
        this.perfilError.set('No se ha podido obtener tu perfil.');
        this.perfilCargando.set(false);
        return;
      }

      const user = userData.user;
      debug += `USER ID: ${user.id}\n`;
      debug += `USER EMAIL: ${user.email}\n`;

      // 2) Perfil en tabla perfiles
      const { data: perfil, error: perfilError } = await client
        .from('perfiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (perfilError) {
        debug += `ERROR PERFIL: ${JSON.stringify(perfilError)}`;
        this.debugData.set(debug);
        this.perfilError.set('No se ha podido cargar tu perfil.');
        this.perfilCargando.set(false);
        return;
      }

      if (!perfil) {
        debug += `PERFIL: NULL - No existe registro en tabla perfiles para este usuario`;
        this.debugData.set(debug);
        this.perfilError.set('No tienes perfil configurado. Contacta con el administrador.');
        this.perfilCargando.set(false);
        return;
      }

      debug += `PERFIL: ${JSON.stringify(perfil)}\n`;
      debug += `ROL RAW: "${perfil.rol}" (length: ${(perfil.rol || '').length})\n`;

      const rolRaw = (perfil.rol || '').toLowerCase().trim();

      debug += `ROL PROCESADO: "${rolRaw}"\n`;
      debug += `¿Es "admin"?: ${rolRaw === 'admin'}\n`;

      let rol: UserRole = 'cliente';
      if (rolRaw === 'profesor') rol = 'profesor';
      if (rolRaw === 'admin') rol = 'admin';

      debug += `ROL FINAL: ${rol}`;

      this.debugData.set(debug);
      this.role.set(rol);
      this.nombre.set(perfil.nombre || user.email || null);

      console.log('[Dashboard] Debug:', debug);
    } catch (e) {
      this.debugData.set(`EXCEPTION: ${e}`);
      this.perfilError.set('Ha ocurrido un error.');
    } finally {
      this.perfilCargando.set(false);
    }
  }

  // Handlers
  onReservaCita() {
    this.router.navigateByUrl('/reservar-cita');
  }
  onVerCalendario() {
    console.log('Ver calendario');
  }
  onPerfil() {
    console.log('Mi perfil');
  }
  onMisGrupos() {
    console.log('Mis grupos');
  }
  onVerCitas() {
    console.log('Ver citas');
  }
  onVerGrupos() {
    console.log('Ver grupos');
  }
  onGestionarPerfiles() {
    this.router.navigateByUrl('/gestionar-perfiles');
  }

  async onLogout() {
    await supabase().auth.signOut();
    this.router.navigateByUrl('/login');
  }
}
