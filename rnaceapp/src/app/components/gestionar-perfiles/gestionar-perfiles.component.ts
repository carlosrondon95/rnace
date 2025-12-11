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
  tipoCuota: 'semanal' | 'mensual';
  password: string;
}

interface UsuarioDB {
  id: string;
  telefono: string;
  nombre: string | null;
  rol: string;
  activo: boolean;
  creado_en: string;
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

  // Estado
  cargando = signal(true);
  error = signal<string | null>(null);
  usuarios = signal<Usuario[]>([]);
  busqueda = signal('');

  // Filtros
  filtros = signal<Filtros>({
    rol: 'todos',
    activo: 'todos',
    tipoGrupo: 'todos',
  });

  // Modal (compartido para crear/editar)
  mostrarModal = signal(false);
  modoEdicion = signal(false);
  usuarioEditandoId = signal<string | null>(null);
  guardando = signal(false);
  errorModal = signal<string | null>(null);
  exitoModal = signal<string | null>(null);
  passwordCopiada = signal(false);

  // Formulario
  formulario = signal<FormularioUsuario>({
    nombre: '',
    apellidos: '',
    telefono: '',
    rol: 'cliente',
    activo: true,
    tipoGrupo: 'focus',
    clasesFocus: 2,
    clasesReducido: 0,
    tipoCuota: 'semanal',
    password: '',
  });

  // Usuarios filtrados
  usuariosFiltrados = computed(() => {
    const busq = this.busqueda().toLowerCase().trim();
    const f = this.filtros();
    let lista = this.usuarios();

    // Filtro por búsqueda
    if (busq) {
      lista = lista.filter(
        (u) => u.nombre?.toLowerCase().includes(busq) || u.telefono?.includes(busq),
      );
    }

    // Filtro por rol
    if (f.rol !== 'todos') {
      lista = lista.filter((u) => u.rol === f.rol);
    }

    // Filtro por estado activo
    if (f.activo !== 'todos') {
      const esActivo = f.activo === 'activo';
      lista = lista.filter((u) => u.activo === esActivo);
    }

    // Filtro por tipo de grupo
    if (f.tipoGrupo !== 'todos') {
      lista = lista.filter((u) => u.plan?.tipo_grupo === f.tipoGrupo);
    }

    return lista;
  });

  // Opciones
  tiposGrupo = [
    { value: 'focus', label: 'Focus (máx 3 personas)' },
    { value: 'reducido', label: 'Reducido (máx 8 personas)' },
    { value: 'hibrido', label: 'Híbrido (Focus + Reducido)' },
    { value: 'especial', label: 'Especial (cuota personalizada)' },
  ];

  roles = [
    { value: 'cliente', label: 'Cliente' },
    { value: 'profesor', label: 'Profesor' },
    { value: 'admin', label: 'Administrador' },
  ];

  clasesOptions = [0, 1, 2, 3, 4, 5, 6, 7];

  @HostListener('document:keydown.escape')
  onEscapeKey() {
    if (this.mostrarModal()) {
      this.cerrarModal();
    }
  }

  ngOnInit() {
    this.cargarUsuarios();
  }

  // ========== CARGA DE DATOS ==========

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
        console.error('Error cargando usuarios:', usuariosError);
        this.error.set('Error al cargar los usuarios.');
        return;
      }

      const { data: planesData, error: planesError } = await client
        .from('plan_usuario')
        .select(
          'usuario_id, tipo_grupo, clases_focus_semana, clases_reducido_semana, tipo_cuota, activo',
        );

      if (planesError) {
        console.error('Error cargando planes:', planesError);
      }

      const planesMap = new Map<string, PerfilPlan>();
      if (planesData) {
        for (const plan of planesData) {
          planesMap.set(plan.usuario_id, {
            tipo_grupo: plan.tipo_grupo,
            clases_focus_semana: plan.clases_focus_semana,
            clases_reducido_semana: plan.clases_reducido_semana,
            tipo_cuota: plan.tipo_cuota,
            activo: plan.activo,
          });
        }
      }

      const usuarios: Usuario[] = ((usuariosData || []) as UsuarioDB[]).map((u) => ({
        id: u.id,
        telefono: u.telefono || '',
        nombre: u.nombre || '',
        rol: u.rol,
        activo: u.activo,
        creado_en: u.creado_en,
        plan: planesMap.get(u.id),
      }));

      this.usuarios.set(usuarios);
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error inesperado al cargar usuarios.');
    } finally {
      this.cargando.set(false);
    }
  }

  // ========== FILTROS ==========

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

  // ========== MODAL CREAR ==========

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
      tipoCuota: 'semanal',
      password: '',
    });
    this.errorModal.set(null);
    this.exitoModal.set(null);
    this.passwordCopiada.set(false);
    this.mostrarModal.set(true);
  }

  // ========== MODAL EDITAR ==========

  abrirModalEditar(usuario: Usuario) {
    this.modoEdicion.set(true);
    this.usuarioEditandoId.set(usuario.id);

    // Separar nombre y apellidos
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

  // ========== FORMULARIO ==========

  actualizarCampo(campo: keyof FormularioUsuario, valor: string | number | boolean) {
    this.formulario.update((f) => ({ ...f, [campo]: valor }));

    // Ajustar clases según tipo de grupo
    if (campo === 'tipoGrupo') {
      const tipo = valor as FormularioUsuario['tipoGrupo'];
      if (tipo === 'focus') {
        this.formulario.update((f) => ({ ...f, clasesFocus: 2, clasesReducido: 0 }));
      } else if (tipo === 'reducido') {
        this.formulario.update((f) => ({ ...f, clasesFocus: 0, clasesReducido: 2 }));
      } else if (tipo === 'hibrido') {
        this.formulario.update((f) => ({ ...f, clasesFocus: 1, clasesReducido: 1 }));
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
    const baseValido = !!(
      f.nombre.trim() &&
      f.telefono.trim() &&
      f.telefono.length >= 9 &&
      (f.clasesFocus > 0 || f.clasesReducido > 0)
    );

    // En modo crear, la contraseña es obligatoria
    if (!this.modoEdicion()) {
      return baseValido && f.password.length >= 6;
    }

    // En modo editar, la contraseña es opcional (si se pone, mínimo 6)
    if (f.password && f.password.length < 6) {
      return false;
    }

    return baseValido;
  }

  // ========== GUARDAR ==========

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

    // Actualizar datos del usuario
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

    // Actualizar o crear plan
    const { data: planExistente } = await client
      .from('plan_usuario')
      .select('id')
      .eq('usuario_id', userId)
      .single();

    if (planExistente) {
      await client
        .from('plan_usuario')
        .update({
          tipo_grupo: f.tipoGrupo,
          clases_focus_semana: f.clasesFocus,
          clases_reducido_semana: f.clasesReducido,
          tipo_cuota: f.tipoCuota,
        })
        .eq('usuario_id', userId);
    } else {
      await client.from('plan_usuario').insert({
        usuario_id: userId,
        tipo_grupo: f.tipoGrupo,
        clases_focus_semana: f.clasesFocus,
        clases_reducido_semana: f.clasesReducido,
        tipo_cuota: f.tipoCuota,
        activo: true,
      });
    }

    // Si se especificó nueva contraseña, cambiarla
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

  // ========== UTILIDADES ==========

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
    const focus = plan.clases_focus_semana || 0;
    const reducido = plan.clases_reducido_semana || 0;
    const cuota = plan.tipo_cuota === 'mensual' ? '/mes' : '/sem';

    if (tipo === 'focus') return `Focus ${focus}${cuota}`;
    if (tipo === 'reducido') return `Reducido ${reducido}${cuota}`;
    if (tipo === 'hibrido') return `Híbrido F${focus}+R${reducido}${cuota}`;
    if (tipo === 'especial') return `Especial ${focus + reducido}${cuota}`;

    return 'Sin plan';
  }

  obtenerClaseRol(rol: string): string {
    if (rol === 'admin') return 'rol-admin';
    if (rol === 'profesor') return 'rol-profesor';
    return 'rol-cliente';
  }

  obtenerClaseActivo(activo: boolean): string {
    return activo ? 'estado-activo' : 'estado-inactivo';
  }

  volver() {
    this.router.navigateByUrl('/dashboard');
  }
}
