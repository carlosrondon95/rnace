// src/app/components/gestionar-perfiles/gestionar-perfiles.component.ts
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal, computed, HostListener } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { supabase } from '../../core/supabase.client';

interface HorarioDisponible {
  id: number;
  modalidad: 'focus' | 'reducido';
  dia_semana: number; // 1=Lunes, 5=Viernes
  hora: string;
  capacidad_maxima: number;
}

interface HorarioFijoUsuario {
  id: number;
  horario_disponible_id: number;
  horario?: HorarioDisponible;
}

interface Usuario {
  id: string;
  telefono: string;
  nombre: string;
  rol: string;
  activo: boolean;
  creado_en: string;
  tipo_grupo?: string;
  horarios_fijos?: HorarioFijoUsuario[];
}

interface FormularioUsuario {
  nombre: string;
  apellidos: string;
  telefono: string;
  rol: 'cliente' | 'profesor' | 'admin';
  activo: boolean;
  tipoGrupo: 'focus' | 'reducido' | 'hibrido' | 'especial';
  password: string;
  horariosSeleccionados: number[]; // IDs de horarios_disponibles
}

interface Filtros {
  rol: string;
  activo: string;
  tipoGrupo: string;
}

interface HorarioPorDia {
  dia: number;
  diaNombre: string;
  horarios: HorarioDisponible[];
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

  // Horarios disponibles del centro
  horariosDisponibles = signal<HorarioDisponible[]>([]);

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
    password: '',
    horariosSeleccionados: [],
  });

  // Nombres de días
  diasSemana: { [key: number]: string } = {
    1: 'Lunes',
    2: 'Martes',
    3: 'Miércoles',
    4: 'Jueves',
    5: 'Viernes',
  };

  // Horarios agrupados por día para el selector
  horariosFocusPorDia = computed((): HorarioPorDia[] => {
    const horarios = this.horariosDisponibles().filter(h => h.modalidad === 'focus');
    return this.agruparPorDia(horarios);
  });

  horariosReducidoPorDia = computed((): HorarioPorDia[] => {
    const horarios = this.horariosDisponibles().filter(h => h.modalidad === 'reducido');
    return this.agruparPorDia(horarios);
  });

  // Horarios filtrados según tipo de grupo seleccionado
  horariosParaMostrar = computed((): HorarioPorDia[] => {
    const tipo = this.formulario().tipoGrupo;
    if (tipo === 'focus') {
      return this.horariosFocusPorDia();
    } else if (tipo === 'reducido') {
      return this.horariosReducidoPorDia();
    } else {
      // Híbrido o especial: mostrar ambos
      const focus = this.horariosFocusPorDia();
      const reducido = this.horariosReducidoPorDia();
      // Combinar y ordenar
      const todos: HorarioPorDia[] = [];
      for (let dia = 1; dia <= 5; dia++) {
        const horariosDia: HorarioDisponible[] = [
          ...(focus.find(f => f.dia === dia)?.horarios || []),
          ...(reducido.find(r => r.dia === dia)?.horarios || []),
        ].sort((a, b) => a.hora.localeCompare(b.hora));
        
        if (horariosDia.length > 0) {
          todos.push({
            dia,
            diaNombre: this.diasSemana[dia],
            horarios: horariosDia,
          });
        }
      }
      return todos;
    }
  });

  private agruparPorDia(horarios: HorarioDisponible[]): HorarioPorDia[] {
    const porDia = new Map<number, HorarioDisponible[]>();
    
    for (const h of horarios) {
      if (!porDia.has(h.dia_semana)) {
        porDia.set(h.dia_semana, []);
      }
      porDia.get(h.dia_semana)!.push(h);
    }

    const resultado: HorarioPorDia[] = [];
    for (let dia = 1; dia <= 5; dia++) {
      const horariosDia = porDia.get(dia) || [];
      if (horariosDia.length > 0) {
        resultado.push({
          dia,
          diaNombre: this.diasSemana[dia],
          horarios: horariosDia.sort((a, b) => a.hora.localeCompare(b.hora)),
        });
      }
    }

    return resultado;
  }

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
      lista = lista.filter((u) => u.tipo_grupo === f.tipoGrupo);
    }

    return lista;
  });

  tiposGrupo = [
    { value: 'focus', label: 'Focus (máx 3 personas)' },
    { value: 'reducido', label: 'Reducido (máx 8 personas)' },
    { value: 'hibrido', label: 'Híbrido (Focus + Reducido)' },
    { value: 'especial', label: 'Especial' },
  ];

  roles = [
    { value: 'cliente', label: 'Cliente' },
    { value: 'profesor', label: 'Profesor' },
    { value: 'admin', label: 'Administrador' },
  ];

  @HostListener('document:keydown.escape')
  onEscapeKey() {
    if (this.mostrarModal()) this.cerrarModal();
    if (this.mostrarModalEliminar()) this.cerrarModalEliminar();
  }

  ngOnInit() {
    this.cargarDatos();
  }

  async cargarDatos() {
    this.cargando.set(true);
    this.error.set(null);

    try {
      await Promise.all([
        this.cargarHorariosDisponibles(),
        this.cargarUsuarios(),
      ]);
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error inesperado al cargar datos.');
    } finally {
      this.cargando.set(false);
    }
  }

  async cargarHorariosDisponibles() {
    const { data, error } = await supabase()
      .from('horarios_disponibles')
      .select('*')
      .eq('activo', true)
      .order('dia_semana')
      .order('hora');

    if (error) {
      console.error('Error cargando horarios:', error);
      return;
    }

    this.horariosDisponibles.set(data || []);
  }

  async cargarUsuarios() {
    const client = supabase();

    // Cargar usuarios
    const { data: usuariosData, error: usuariosError } = await client
      .from('usuarios')
      .select('id, telefono, nombre, rol, activo, creado_en')
      .order('nombre');

    if (usuariosError) {
      this.error.set('Error al cargar los usuarios.');
      return;
    }

    // Cargar planes
    const { data: planesData } = await client
      .from('plan_usuario')
      .select('usuario_id, tipo_grupo');

    const planesMap = new Map<string, string>();
    if (planesData) {
      for (const plan of planesData) {
        planesMap.set(plan.usuario_id, plan.tipo_grupo);
      }
    }

    // Cargar horarios fijos de usuarios
    const { data: horariosFijosData } = await client
      .from('horario_fijo_usuario')
      .select(`
        id,
        usuario_id,
        horario_disponible_id,
        horarios_disponibles (
          id, modalidad, dia_semana, hora, capacidad_maxima
        )
      `)
      .eq('activo', true);

    const horariosMap = new Map<string, HorarioFijoUsuario[]>();
    if (horariosFijosData) {
      for (const hf of horariosFijosData) {
        if (!horariosMap.has(hf.usuario_id)) {
          horariosMap.set(hf.usuario_id, []);
        }
        horariosMap.get(hf.usuario_id)!.push({
          id: hf.id,
          horario_disponible_id: hf.horario_disponible_id,
          horario: hf.horarios_disponibles as unknown as HorarioDisponible,
        });
      }
    }

    const usuarios: Usuario[] = (usuariosData || []).map((u) => ({
      id: u.id,
      telefono: u.telefono || '',
      nombre: u.nombre || '',
      rol: u.rol,
      activo: u.activo,
      creado_en: u.creado_en,
      tipo_grupo: planesMap.get(u.id),
      horarios_fijos: horariosMap.get(u.id) || [],
    }));

    this.usuarios.set(usuarios);
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
      password: '',
      horariosSeleccionados: [],
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

    // Obtener IDs de horarios seleccionados
    const horariosSeleccionados = (usuario.horarios_fijos || []).map(h => h.horario_disponible_id);

    this.formulario.set({
      nombre: nombre,
      apellidos: apellidos,
      telefono: usuario.telefono,
      rol: usuario.rol as 'cliente' | 'profesor' | 'admin',
      activo: usuario.activo,
      tipoGrupo: (usuario.tipo_grupo as FormularioUsuario['tipoGrupo']) || 'focus',
      password: '',
      horariosSeleccionados: horariosSeleccionados,
    });
    this.errorModal.set(null);
    this.exitoModal.set(null);
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

    // Si cambia el tipo de grupo, limpiar horarios seleccionados
    if (campo === 'tipoGrupo') {
      this.formulario.update((f) => ({ ...f, horariosSeleccionados: [] }));
    }
  }

  // Toggle horario seleccionado
  toggleHorario(horarioId: number) {
    this.formulario.update((f) => {
      const seleccionados = [...f.horariosSeleccionados];
      const index = seleccionados.indexOf(horarioId);
      
      if (index > -1) {
        seleccionados.splice(index, 1);
      } else {
        seleccionados.push(horarioId);
      }

      return { ...f, horariosSeleccionados: seleccionados };
    });
  }

  isHorarioSeleccionado(horarioId: number): boolean {
    return this.formulario().horariosSeleccionados.includes(horarioId);
  }

  // Obtener resumen de horarios seleccionados
  getResumenHorarios(): string {
    const ids = this.formulario().horariosSeleccionados;
    if (ids.length === 0) return 'Ningún horario seleccionado';

    const horarios = this.horariosDisponibles().filter(h => ids.includes(h.id));
    const porDia = new Map<number, string[]>();

    for (const h of horarios) {
      if (!porDia.has(h.dia_semana)) {
        porDia.set(h.dia_semana, []);
      }
      porDia.get(h.dia_semana)!.push(h.hora.slice(0, 5));
    }

    const partes: string[] = [];
    for (const [dia, horas] of porDia) {
      partes.push(`${this.diasSemana[dia].slice(0, 3)}: ${horas.join(', ')}`);
    }

    return partes.join(' | ');
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
    
    // Solo clientes necesitan horarios
    const necesitaHorarios = f.rol === 'cliente';
    const tieneHorarios = !necesitaHorarios || f.horariosSeleccionados.length > 0;

    const baseValido = tieneNombre && tieneTelefono && tieneHorarios;

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
    const client = supabase();

    // 1. Crear usuario usando AuthService
    const resultado = await this.authService.crearUsuario({
      telefono: telefono,
      password: f.password,
      nombre: nombre,
      rol: f.rol,
    });

    if (!resultado.success || !resultado.userId) {
      this.errorModal.set(resultado.error || 'Error al crear el usuario.');
      return;
    }

    const userId = resultado.userId;

    // 2. Crear plan_usuario (solo tipo_grupo)
    if (f.rol === 'cliente') {
      await client.from('plan_usuario').insert({
        usuario_id: userId,
        tipo_grupo: f.tipoGrupo,
        activo: true,
      });

      // 3. Crear horarios fijos
      if (f.horariosSeleccionados.length > 0) {
        const horariosInsert = f.horariosSeleccionados.map(horarioId => ({
          usuario_id: userId,
          horario_disponible_id: horarioId,
          activo: true,
        }));

        const { error: horariosError } = await client
          .from('horario_fijo_usuario')
          .insert(horariosInsert);

        if (horariosError) {
          console.error('Error creando horarios fijos:', horariosError);
        }
      }
    }

    this.exitoModal.set(`Usuario creado. Teléfono: ${telefono}`);
    await this.cargarUsuarios();
  }

  private async actualizarUsuario(nombre: string, telefono: string, f: FormularioUsuario) {
    const userId = this.usuarioEditandoId();
    if (!userId) return;

    const client = supabase();

    // 1. Actualizar usuario
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

    // 2. Actualizar plan
    if (f.rol === 'cliente') {
      const { data: planExistente } = await client
        .from('plan_usuario')
        .select('usuario_id')
        .eq('usuario_id', userId)
        .single();

      if (planExistente) {
        await client
          .from('plan_usuario')
          .update({ tipo_grupo: f.tipoGrupo })
          .eq('usuario_id', userId);
      } else {
        await client.from('plan_usuario').insert({
          usuario_id: userId,
          tipo_grupo: f.tipoGrupo,
          activo: true,
        });
      }

      // 3. Actualizar horarios fijos
      // Eliminar los actuales
      await client
        .from('horario_fijo_usuario')
        .delete()
        .eq('usuario_id', userId);

      // Insertar los nuevos
      if (f.horariosSeleccionados.length > 0) {
        const horariosInsert = f.horariosSeleccionados.map(horarioId => ({
          usuario_id: userId,
          horario_disponible_id: horarioId,
          activo: true,
        }));

        await client.from('horario_fijo_usuario').insert(horariosInsert);
      }
    }

    // 4. Cambiar contraseña si se indicó
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

  obtenerEtiquetaGrupo(usuario: Usuario): string {
    if (!usuario.tipo_grupo) return 'Sin plan';

    const tipo = usuario.tipo_grupo;
    const numHorarios = usuario.horarios_fijos?.length || 0;

    if (tipo === 'focus') return `Focus (${numHorarios} clases/sem)`;
    if (tipo === 'reducido') return `Reducido (${numHorarios} clases/sem)`;
    if (tipo === 'hibrido') return `Híbrido (${numHorarios} clases/sem)`;
    if (tipo === 'especial') return `Especial (${numHorarios} clases/sem)`;

    return 'Sin plan';
  }

  obtenerHorariosTexto(usuario: Usuario): string {
    const horarios = usuario.horarios_fijos || [];
    if (horarios.length === 0) return '';

    const porDia = new Map<number, string[]>();
    for (const hf of horarios) {
      const h = hf.horario;
      if (!h) continue;
      if (!porDia.has(h.dia_semana)) {
        porDia.set(h.dia_semana, []);
      }
      porDia.get(h.dia_semana)!.push(h.hora.slice(0, 5));
    }

    const partes: string[] = [];
    for (const [dia, horas] of [...porDia.entries()].sort((a, b) => a[0] - b[0])) {
      partes.push(`${this.diasSemana[dia].slice(0, 3)} ${horas.join(', ')}`);
    }

    return partes.join(' · ');
  }

  obtenerClaseGrupo(tipo: string | undefined): string {
    if (tipo === 'focus') return 'grupo-focus';
    if (tipo === 'reducido') return 'grupo-reducido';
    if (tipo === 'hibrido') return 'grupo-hibrido';
    if (tipo === 'especial') return 'grupo-especial';
    return '';
  }

  obtenerClaseRol(rol: string): string {
    if (rol === 'admin') return 'rol-admin';
    if (rol === 'profesor') return 'rol-profesor';
    return 'rol-cliente';
  }

  formatHora(hora: string): string {
    return hora.slice(0, 5);
  }

  volver() {
    this.router.navigateByUrl('/dashboard');
  }
}