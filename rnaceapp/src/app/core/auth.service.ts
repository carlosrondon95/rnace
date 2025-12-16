// src/app/core/auth.service.ts
import { Injectable, signal, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { supabase } from './supabase.client';
import * as bcrypt from 'bcryptjs';

export interface Usuario {
  id: string;
  telefono: string;
  nombre: string | null;
  rol: 'cliente' | 'profesor' | 'admin';
  activo: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private platformId = inject(PLATFORM_ID);
  private usuarioActual = signal<Usuario | null>(null);

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.cargarUsuarioGuardado();
    }
  }

  get usuario() {
    return this.usuarioActual;
  }

  estaLogueado(): boolean {
    return this.usuarioActual() !== null;
  }

  getRol(): string {
    return this.usuarioActual()?.rol || 'cliente';
  }

  userId = () => this.usuarioActual()?.id || null;

  private cargarUsuarioGuardado() {
    if (!isPlatformBrowser(this.platformId)) return;

    try {
      const guardado = localStorage.getItem('rnace_usuario');
      if (guardado) {
        const usuario = JSON.parse(guardado) as Usuario;
        this.usuarioActual.set(usuario);
      }
    } catch (error) {
      console.error('Error cargando usuario guardado:', error);
      localStorage.removeItem('rnace_usuario');
    }
  }

  private guardarUsuario(usuario: Usuario) {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('rnace_usuario', JSON.stringify(usuario));
    }
    this.usuarioActual.set(usuario);
  }

  async login(telefono: string, password: string): Promise<{ success: boolean; error?: string }> {
    try {
      const telefonoLimpio = telefono.replace(/[^0-9]/g, '');

      if (!telefonoLimpio || telefonoLimpio.length < 9) {
        return { success: false, error: 'Teléfono inválido' };
      }

      if (!password || password.length < 4) {
        return { success: false, error: 'Contraseña inválida' };
      }

      const { data: usuario, error } = await supabase()
        .from('usuarios')
        .select('*')
        .eq('telefono', telefonoLimpio)
        .eq('activo', true)
        .single();

      if (error || !usuario) {
        return { success: false, error: 'Usuario o contraseña incorrectos' };
      }

      const passwordValida = await bcrypt.compare(password, usuario.password_hash);

      if (!passwordValida) {
        return { success: false, error: 'Usuario o contraseña incorrectos' };
      }

      const usuarioLimpio: Usuario = {
        id: usuario.id,
        telefono: usuario.telefono,
        nombre: usuario.nombre,
        rol: usuario.rol,
        activo: usuario.activo,
      };

      this.guardarUsuario(usuarioLimpio);
      return { success: true };
    } catch (error) {
      console.error('Error en login:', error);
      return { success: false, error: 'Error al iniciar sesión' };
    }
  }

  logout() {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('rnace_usuario');
    }
    this.usuarioActual.set(null);
  }

  async crearUsuario(datos: {
    telefono: string;
    password: string;
    nombre: string;
    rol?: string;
  }): Promise<{ success: boolean; error?: string; userId?: string }> {
    try {
      if (this.getRol() !== 'admin') {
        return { success: false, error: 'Solo los administradores pueden crear usuarios' };
      }

      const telefonoLimpio = datos.telefono.replace(/[^0-9]/g, '');

      const { data: existente } = await supabase()
        .from('usuarios')
        .select('id')
        .eq('telefono', telefonoLimpio)
        .single();

      if (existente) {
        return { success: false, error: 'Ya existe un usuario con ese teléfono' };
      }

      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(datos.password, salt);

      const { data: nuevoUsuario, error } = await supabase()
        .from('usuarios')
        .insert({
          telefono: telefonoLimpio,
          password_hash: passwordHash,
          nombre: datos.nombre,
          rol: datos.rol || 'cliente',
          activo: true,
        })
        .select('id')
        .single();

      if (error) {
        console.error('Error creando usuario:', error);
        return { success: false, error: 'Error al crear usuario: ' + error.message };
      }

      return { success: true, userId: nuevoUsuario.id };
    } catch (error) {
      console.error('Error:', error);
      return { success: false, error: 'Error inesperado al crear usuario' };
    }
  }

  // Crear usuario con plan - SOPORTA PLAN ESPECIAL
  async crearUsuarioConPlan(datos: {
    telefono: string;
    password: string;
    nombre: string;
    rol?: string;
    tipoGrupo: string;
    clasesFocus: number;
    clasesReducido: number;
    tipoCuota: string;
    sesionesFijasFocus?: number;
    sesionesFijasReducido?: number;
  }): Promise<{ success: boolean; error?: string; userId?: string }> {
    try {
      const resultado = await this.crearUsuario({
        telefono: datos.telefono,
        password: datos.password,
        nombre: datos.nombre,
        rol: datos.rol,
      });

      if (!resultado.success || !resultado.userId) {
        return resultado;
      }

      const planData: Record<string, unknown> = {
        usuario_id: resultado.userId,
        tipo_grupo: datos.tipoGrupo,
        tipo_cuota: datos.tipoCuota,
        activo: true,
      };

      if (datos.tipoGrupo === 'especial') {
        planData['clases_focus_semana'] = 0;
        planData['clases_reducido_semana'] = 0;
        planData['sesiones_fijas_mes_focus'] = datos.sesionesFijasFocus || 0;
        planData['sesiones_fijas_mes_reducido'] = datos.sesionesFijasReducido || 0;
      } else {
        planData['clases_focus_semana'] = datos.clasesFocus;
        planData['clases_reducido_semana'] = datos.clasesReducido;
        planData['sesiones_fijas_mes_focus'] = null;
        planData['sesiones_fijas_mes_reducido'] = null;
      }

      const { error: planError } = await supabase().from('plan_usuario').insert(planData);

      if (planError) {
        console.error('Error creando plan:', planError);
      }

      return { success: true, userId: resultado.userId };
    } catch (error) {
      console.error('Error:', error);
      return { success: false, error: 'Error inesperado' };
    }
  }

  // Eliminar usuario (solo admin)
  async eliminarUsuario(userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.getRol() !== 'admin') {
        return { success: false, error: 'Solo los administradores pueden eliminar usuarios' };
      }

      if (this.userId() === userId) {
        return { success: false, error: 'No puedes eliminar tu propia cuenta' };
      }

      const { error } = await supabase().from('usuarios').delete().eq('id', userId);

      if (error) {
        console.error('Error eliminando usuario:', error);
        return { success: false, error: 'Error al eliminar: ' + error.message };
      }

      return { success: true };
    } catch (error) {
      console.error('Error:', error);
      return { success: false, error: 'Error inesperado' };
    }
  }

  async cambiarPassword(
    telefonoOId: string,
    nuevaPassword: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const esAdmin = this.getRol() === 'admin';
      const esSuCuenta =
        this.usuarioActual()?.telefono === telefonoOId || this.usuarioActual()?.id === telefonoOId;

      if (!esAdmin && !esSuCuenta) {
        return { success: false, error: 'No tienes permisos para cambiar esta contraseña' };
      }

      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(nuevaPassword, salt);

      const { error } = await supabase()
        .from('usuarios')
        .update({ password_hash: passwordHash, actualizado_en: new Date().toISOString() })
        .or(`telefono.eq.${telefonoOId},id.eq.${telefonoOId}`);

      if (error) {
        return { success: false, error: 'Error al cambiar contraseña' };
      }

      return { success: true };
    } catch (error) {
      console.error('Error:', error);
      return { success: false, error: 'Error inesperado' };
    }
  }
}