// src/app/components/gestionar-perfiles/gestionar-perfiles.component.ts
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal, computed, HostListener } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { supabase } from '../../core/supabase.client';

interface PerfilPlan {
  tipo_grupo: string;
  clases_focus_semana: number;
  clases_reducido_semana: number;
  sesiones_fijas_mes_focus?: number | null;
  sesiones_fijas_mes_reducido?: number | null;
  tipo_cuota: string;
  activo: boolean;
}

interface Usuario {
  id: string;
  telefono: string;
  nombre: string;
  rol: string;
  activo: boolean;
  creado_en: string;
  plan?: PerfilPlan;
}

interface FormularioUsuario {
  nombre: string;
  apellidos: string;
  telefono: string;
  rol: 'cliente' | 'profesor' | 'admin';
  activo: boolean;
  tipoGrupo: 'focus' | 'reducido' | 'hibrido' | 'especial';
  clasesFocus: number;
  clasesReducido: number;
  sesionesFijasFocus: number;
  sesionesFijasReducido: number;
  tipoCuota: 'semanal' | 'mensual';
  password: string;
}

interface Filtros {
  rol: string;
  activo: string;
  tipoGrupo: string;
}

@Component({
  standalone: true,
  selector: 'app-gestionar-perfiles',
  imports: [CommonModule, FormsModule],
  templateUrl: './gestionar-perfiles.component.html',
  styleUrls: ['./gestionar-perfiles.component.scss'],
})
export class GestionarPerfilesComponent implements OnInit {
  private router = inject(Router);
  private authService = inject(AuthService);

  cargando = signal(true);
  error = signal<string | null>(null);
  usuarios = signal<Usuario[]>([]);
  busqueda = signal('');

  filtros = signal<Filtros>({
    rol: 'todos',
    activo: 'todos',
    tipoGrupo: 'todos',
  });

  // Modal crear/editar
  mostrarModal = signal(false);
  modoEdicion = signal(false);
  usuarioEditandoId = signal<string | null>(null);
  guardando = signal(false);
  errorModal = signal<string | null>(null);
  exitoModal = signal<string | null>(null);
  passwordCopiada = signal(false);

  // Modal eliminar
  mostrarModalEliminar = signal(false);
  usuarioAEliminar = signal<Usuario | null>(null);
  eliminando = signal(false);

  formulario = signal<FormularioUsuario>({
    nombre: '',
    apellidos: '',
    telefono: '',
    rol: 'cliente',
    activo: true,
    tipoGrupo: 'focus',
    clasesFocus: 2,
    clasesReducido: 0,
    sesionesFijasFocus: 4,
    sesionesFijasReducido: 0,
    tipoCuota: 'semanal',
    password: '',
  });

  usuariosFiltrados = computed(() => {
    const busq = this.busqueda().toLowerCase().trim();
    const f = this.filtros();
    let lista = this.usuarios();

    if (busq) {
      lista = lista.filter(
        (u) => u.nombre?.toLowerCase().includes(busq) || u.telefono?.includes(busq),
      );
    }

    if (f.rol !== 'todos') {
      lista = lista.filter((u) => u.rol === f.rol);
    }

    if (f.activo !== 'todos') {
      const esActivo = f.activo === 'activo';
      lista = lista.filter((u) => u.activo === esActivo);
    }

    if (f.tipoGrupo !== 'todos') {
      lista = lista.filter((u) => u.plan?.tipo_grupo === f.tipoGrupo);
    }

    return lista;
  });

  tiposGrupo = [
    { value: 'focus', label: 'Focus (máx 3 personas)' },
    { value: 'reducido', label: 'Reducido (máx 8 personas)' },
    { value: 'hibrido', label: 'Híbrido (Focus + Reducido)' },
    { value: 'especial', label: 'Especial (sesiones fijas al mes)' },
  ];

  roles = [
    { value: 'cliente', label: 'Cliente' },
    { value: 'profesor', label: 'Profesor' },
    { value: 'admin', label: 'Administrador' },
  ];

  clasesOptions = [0, 1, 2, 3, 4, 5, 6, 7];
  sesionesEspecialOptions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20];

  @HostListener('document:keydown.escape')
  onEscapeKey() {
    if (this.mostrarModal()) this.cerrarModal();
    if (this.mostrarModalEliminar()) this.cerrarModalEliminar();
  }

  ngOnInit() {
    this.cargarUsuarios();
  }

  async cargarUsuarios() {
    this.cargando.set(true);
    this.error.set(null);

    try {
      const client = supabase();

      const { data: usuariosData, error: usuariosError } = await client
        .from('usuarios')
        .select('id, telefono, nombre, rol, activo, creado_en')
        .order('creado_en', { ascending: false });

      if (usuariosError) {
        this.error.set('Error al cargar los usuarios.');
        return;
      }

      const { data: planesData } = await client
        .from('plan_usuario')
        .select(
          'usuario_id, tipo_grupo, clases_focus_semana, clases_reducido_semana, sesiones_fijas_mes_focus, sesiones_fijas_mes_reducido, tipo_cuota, activo',
        );

      const planesMap = new Map<string, PerfilPlan>();
      if (planesData) {
        for (const plan of planesData) {
          planesMap.set(plan.usuario_id, {
            tipo_grupo: plan.tipo_grupo,
            clases_focus_semana: plan.clases_focus_semana,
            clases_reducido_semana: plan.clases_reducido_semana,
            sesiones_fijas_mes_focus: plan.sesiones_fijas_mes_focus,
            sesiones_fijas_mes_reducido: plan.sesiones_fijas_mes_reducido,
            tipo_cuota: plan.tipo_cuota,
            activo: plan.activo,
          });
        }
      }

      const usuarios: Usuario[] = (usuariosData || []).map(
        (u: {
          id: string;
          telefono: string;
          nombre: string | null;
          rol: string;
          activo: boolean;
          creado_en: string;
        }) => ({
          id: u.id,
          telefono: u.telefono || '',
          nombre: u.nombre || '',
          rol: u.rol,
          activo: u.activo,
          creado_en: u.creado_en,
          plan: planesMap.get(u.id),
        }),
      );

      this.usuarios.set(usuarios);
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error inesperado al cargar usuarios.');
    } finally {
      this.cargando.set(false);
    }
  }

  actualizarFiltro(filtro: keyof Filtros, valor: string) {
    this.filtros.update((f) => ({ ...f, [filtro]: valor }));
  }

  limpiarFiltros() {
    this.filtros.set({ rol: 'todos', activo: 'todos', tipoGrupo: 'todos' });
    this.busqueda.set('');
  }

  hayFiltrosActivos(): boolean {
    const f = this.filtros();
    return (
      f.rol !== 'todos' || f.activo !== 'todos' || f.tipoGrupo !== 'todos' || this.busqueda() !== ''
    );
  }

  abrirModalNuevo() {
    this.modoEdicion.set(false);
    this.usuarioEditandoId.set(null);
    this.formulario.set({
      nombre: '',
      apellidos: '',
      telefono: '',
      rol: 'cliente',
      activo: true,
      tipoGrupo: 'focus',
      clasesFocus: 2,
      clasesReducido: 0,
      sesionesFijasFocus: 4,
      sesionesFijasReducido: 0,
      tipoCuota: 'semanal',
      password: '',
    });
    this.errorModal.set(null);
    this.exitoModal.set(null);
    this.passwordCopiada.set(false);
    this.mostrarModal.set(true);
  }

  abrirModalEditar(usuario: Usuario) {
    this.modoEdicion.set(true);
    this.usuarioEditandoId.set(usuario.id);

    const partes = (usuario.nombre || '').split(' ');
    const nombre = partes[0] || '';
    const apellidos = partes.slice(1).join(' ') || '';

    this.formulario.set({
      nombre: nombre,
      apellidos: apellidos,
      telefono: usuario.telefono,
      rol: usuario.rol as 'cliente' | 'profesor' | 'admin',
      activo: usuario.activo,
      tipoGrupo: (usuario.plan?.tipo_grupo as FormularioUsuario['tipoGrupo']) || 'focus',
      clasesFocus: usuario.plan?.clases_focus_semana || 0,
      clasesReducido: usuario.plan?.clases_reducido_semana || 0,
      sesionesFijasFocus: usuario.plan?.sesiones_fijas_mes_focus || 0,
      sesionesFijasReducido: usuario.plan?.sesiones_fijas_mes_reducido || 0,
      tipoCuota: (usuario.plan?.tipo_cuota as 'semanal' | 'mensual') || 'semanal',
      password: '',
    });

    this.errorModal.set(null);
    this.exitoModal.set(null);
    this.passwordCopiada.set(false);
    this.mostrarModal.set(true);
  }

  cerrarModal() {
    this.mostrarModal.set(false);
    this.modoEdicion.set(false);
    this.usuarioEditandoId.set(null);
  }

  // Modal eliminar
  abrirModalEliminar(usuario: Usuario) {
    this.usuarioAEliminar.set(usuario);
    this.mostrarModalEliminar.set(true);
  }

  cerrarModalEliminar() {
    this.mostrarModalEliminar.set(false);
    this.usuarioAEliminar.set(null);
  }

  async confirmarEliminar() {
    const usuario = this.usuarioAEliminar();
    if (!usuario) return;

    this.eliminando.set(true);

    try {
      const resultado = await this.authService.eliminarUsuario(usuario.id);

      if (!resultado.success) {
        this.error.set(resultado.error || 'Error al eliminar usuario.');
        this.cerrarModalEliminar();
        return;
      }

      this.cerrarModalEliminar();
      await this.cargarUsuarios();
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error inesperado al eliminar usuario.');
    } finally {
      this.eliminando.set(false);
    }
  }

  actualizarCampo(campo: keyof FormularioUsuario, valor: string | number | boolean) {
    this.formulario.update((f) => ({ ...f, [campo]: valor }));

    if (campo === 'tipoGrupo') {
      const tipo = valor as FormularioUsuario['tipoGrupo'];
      if (tipo === 'focus') {
        this.formulario.update((f) => ({ ...f, clasesFocus: 2, clasesReducido: 0 }));
      } else if (tipo === 'reducido') {
        this.formulario.update((f) => ({ ...f, clasesFocus: 0, clasesReducido: 2 }));
      } else if (tipo === 'hibrido') {
        this.formulario.update((f) => ({ ...f, clasesFocus: 1, clasesReducido: 1 }));
      } else if (tipo === 'especial') {
        this.formulario.update((f) => ({ ...f, sesionesFijasFocus: 4, sesionesFijasReducido: 0 }));
      }
    }
  }

  generarPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < 8; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    this.formulario.update((f) => ({ ...f, password }));
    this.passwordCopiada.set(false);
  }

  async copiarPassword() {
    const pass = this.formulario().password;
    if (!pass) return;

    try {
      await navigator.clipboard.writeText(pass);
      this.passwordCopiada.set(true);
      setTimeout(() => this.passwordCopiada.set(false), 2000);
    } catch (err) {
      console.error('Error copiando:', err);
    }
  }

  formularioValido(): boolean {
    const f = this.formulario();
    const tieneNombre = f.nombre.trim().length > 0;
    const tieneTelefono = f.telefono.trim().length >= 9;

    let tieneClases = false;
    if (f.tipoGrupo === 'especial') {
      tieneClases = f.sesionesFijasFocus > 0 || f.sesionesFijasReducido > 0;
    } else {
      tieneClases = f.clasesFocus > 0 || f.clasesReducido > 0;
    }

    const baseValido = tieneNombre && tieneTelefono && tieneClases;

    if (!this.modoEdicion()) {
      return baseValido && f.password.length >= 6;
    }

    if (f.password && f.password.length < 6) {
      return false;
    }

    return baseValido;
  }

  async guardarUsuario() {
    if (!this.formularioValido()) {
      this.errorModal.set('Por favor, completa todos los campos correctamente.');
      return;
    }

    this.guardando.set(true);
    this.errorModal.set(null);
    this.exitoModal.set(null);

    const f = this.formulario();
    const nombreCompleto = f.apellidos ? `${f.nombre} ${f.apellidos}` : f.nombre;
    const telefonoLimpio = f.telefono.replace(/[^0-9]/g, '');

    try {
      if (this.modoEdicion()) {
        await this.actualizarUsuario(nombreCompleto, telefonoLimpio, f);
      } else {
        await this.crearNuevoUsuario(nombreCompleto, telefonoLimpio, f);
      }
    } catch (err) {
      console.error('Error:', err);
      this.errorModal.set('Error inesperado.');
    } finally {
      this.guardando.set(false);
    }
  }

  private async crearNuevoUsuario(nombre: string, telefono: string, f: FormularioUsuario) {
    const resultado = await this.authService.crearUsuarioConPlan({
      telefono: telefono,
      password: f.password,
      nombre: nombre,
      rol: f.rol,
      tipoGrupo: f.tipoGrupo,
      clasesFocus: f.clasesFocus,
      clasesReducido: f.clasesReducido,
      tipoCuota: f.tipoCuota,
      sesionesFijasFocus: f.sesionesFijasFocus,
      sesionesFijasReducido: f.sesionesFijasReducido,
    });

    if (!resultado.success) {
      this.errorModal.set(resultado.error || 'Error al crear el usuario.');
      return;
    }

    this.exitoModal.set(`Usuario creado. Teléfono: ${telefono}`);
    await this.cargarUsuarios();
  }

  private async actualizarUsuario(nombre: string, telefono: string, f: FormularioUsuario) {
    const userId = this.usuarioEditandoId();
    if (!userId) return;

    const client = supabase();

    const { error: userError } = await client
      .from('usuarios')
      .update({
        nombre: nombre,
        telefono: telefono,
        rol: f.rol,
        activo: f.activo,
        actualizado_en: new Date().toISOString(),
      })
      .eq('id', userId);

    if (userError) {
      this.errorModal.set('Error al actualizar usuario: ' + userError.message);
      return;
    }

    const planData: Record<string, unknown> = {
      tipo_grupo: f.tipoGrupo,
      tipo_cuota: f.tipoCuota,
    };

    if (f.tipoGrupo === 'especial') {
      planData['clases_focus_semana'] = 0;
      planData['clases_reducido_semana'] = 0;
      planData['sesiones_fijas_mes_focus'] = f.sesionesFijasFocus;
      planData['sesiones_fijas_mes_reducido'] = f.sesionesFijasReducido;
    } else {
      planData['clases_focus_semana'] = f.clasesFocus;
      planData['clases_reducido_semana'] = f.clasesReducido;
      planData['sesiones_fijas_mes_focus'] = null;
      planData['sesiones_fijas_mes_reducido'] = null;
    }

    const { data: planExistente } = await client
      .from('plan_usuario')
      .select('usuario_id')
      .eq('usuario_id', userId)
      .single();

    if (planExistente) {
      await client.from('plan_usuario').update(planData).eq('usuario_id', userId);
    } else {
      await client.from('plan_usuario').insert({ ...planData, usuario_id: userId, activo: true });
    }

    if (f.password && f.password.length >= 6) {
      const passResult = await this.authService.cambiarPassword(userId, f.password);
      if (!passResult.success) {
        this.errorModal.set('Usuario actualizado pero error al cambiar contraseña.');
        await this.cargarUsuarios();
        return;
      }
    }

    this.exitoModal.set('Usuario actualizado correctamente.');
    await this.cargarUsuarios();
  }

  formatearFecha(fecha: string): string {
    if (!fecha) return '-';
    return new Date(fecha).toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  obtenerEtiquetaGrupo(plan: PerfilPlan | undefined): string {
    if (!plan) return 'Sin plan';

    const tipo = plan.tipo_grupo || 'sin_plan';

    if (tipo === 'especial') {
      const focus = plan.sesiones_fijas_mes_focus || 0;
      const reducido = plan.sesiones_fijas_mes_reducido || 0;
      if (focus > 0 && reducido > 0) return `Especial F${focus}+R${reducido}/mes`;
      if (focus > 0) return `Especial ${focus}F/mes`;
      if (reducido > 0) return `Especial ${reducido}R/mes`;
      return 'Especial';
    }

    const focus = plan.clases_focus_semana || 0;
    const reducido = plan.clases_reducido_semana || 0;
    const cuota = plan.tipo_cuota === 'mensual' ? '/mes' : '/sem';

    if (tipo === 'focus') return `Focus ${focus}${cuota}`;
    if (tipo === 'reducido') return `Reducido ${reducido}${cuota}`;
    if (tipo === 'hibrido') return `Híbrido F${focus}+R${reducido}${cuota}`;

    return 'Sin plan';
  }

  obtenerClaseRol(rol: string): string {
    if (rol === 'admin') return 'rol-admin';
    if (rol === 'profesor') return 'rol-profesor';
    return 'rol-cliente';
  }

  volver() {
    this.router.navigateByUrl('/dashboard');
  }
}
