// src/app/components/gestionar-perfiles/gestionar-perfiles.component.ts
import { CommonModule, Location } from '@angular/common';
import { Component, OnInit, inject, signal, computed, HostListener } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { supabase } from '../../core/supabase.client';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, getDay, isBefore, startOfDay, addMonths, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';

interface SesionCalendario {
  id: number;
  fecha: string;
  hora: string;
  modalidad: 'focus' | 'reducido';
  capacidad: number;
  ocupadas: number; // calculated from reservas count
}

interface DiaAsignacion {
  fecha: Date;
  dia: number;
  esDelMes: boolean;
  esPasado: boolean;
  sesiones: SesionCalendario[];
}

interface HorarioDisponible {
  id: number;
  modalidad: 'focus' | 'reducido';
  dia_semana: number;
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
  clases_focus?: number;
  clases_reducido?: number;
  clases_por_mes?: number;
  horarios_fijos?: HorarioFijoUsuario[];
}

interface FormularioUsuario {
  nombre: string;
  apellidos: string;
  telefono: string;
  rol: 'cliente' | 'profesor' | 'admin';
  activo: boolean;
  tipoGrupo: 'focus' | 'reducido' | 'hibrido' | 'especial';
  clasesFocus: number;  // Para híbridos: número de clases focus por semana
  clasesReducido: number; // Para híbridos: número de clases reducido por semana
  clasesPorMes: number; // Nuevo campo para Especial
  password: string;
  horariosSeleccionados: number[];
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
  private location = inject(Location);
  private authService = inject(AuthService);

  cargando = signal(true);
  error = signal<string | null>(null);
  usuarios = signal<Usuario[]>([]);
  busqueda = signal('');
  horariosDisponibles = signal<HorarioDisponible[]>([]);

  filtros = signal<Filtros>({
    rol: 'todos',
    activo: 'todos',
    tipoGrupo: 'todos',
  });

  mostrarModal = signal(false);
  modoEdicion = signal(false);
  usuarioEditandoId = signal<string | null>(null);
  guardando = signal(false);
  errorModal = signal<string | null>(null);
  exitoModal = signal<string | null>(null);
  passwordCopiada = signal(false);

  mostrarModalEliminar = signal(false);
  usuarioAEliminar = signal<Usuario | null>(null);
  eliminando = signal(false);

  // Feedback global
  mostrarFeedback = signal(false);
  mensajeFeedback = signal('');

  // Lógica de Asignación por Mes (Especial)
  vistaAsignacion = signal<'semana' | 'mes'>('semana');
  fechaCalendario = signal(new Date());
  modalidadClasesEspecial = signal<'focus' | 'reducido'>('focus');
  sesionesMes = signal<SesionCalendario[]>([]);
  reservasSeleccionadas = signal<Set<number>>(new Set()); // Set of session IDs
  cargandoSesiones = signal(false);

  // Computed days for calendar
  diasCalendario = computed(() => {
    const fecha = this.fechaCalendario();
    const start = startOfMonth(fecha);
    const end = endOfMonth(fecha);
    const allDays = eachDayOfInterval({ start, end });
    const hoy = startOfDay(new Date());

    // Filter out weekends (Saturday = 6, Sunday = 0)
    const weekdays = allDays.filter((day: Date) => {
      const dayOfWeek = getDay(day);
      return dayOfWeek !== 0 && dayOfWeek !== 6;
    });

    return weekdays.map((day: Date) => ({
      fecha: day,
      dia: day.getDate(),
      esDelMes: true,
      esPasado: isBefore(day, hoy),
      sesiones: this.sesionesMes().filter(s => isSameDay(new Date(s.fecha), day))
    }));
  });

  formulario = signal<FormularioUsuario>({
    nombre: '',
    apellidos: '',
    telefono: '',
    rol: 'cliente',
    activo: true,
    tipoGrupo: 'focus',
    clasesFocus: 1,
    clasesReducido: 1,
    clasesPorMes: 0, // Initialize new field
    password: '',
    horariosSeleccionados: [],
  });

  // Usando Record en lugar de index signature
  readonly diasSemana: Record<number, string> = {
    1: 'Lunes',
    2: 'Martes',
    3: 'Miércoles',
    4: 'Jueves',
    5: 'Viernes',
  };

  horariosFocusPorDia = computed((): HorarioPorDia[] => {
    const horarios = this.horariosDisponibles().filter(h => h.modalidad === 'focus');
    return this.agruparPorDia(horarios);
  });

  horariosReducidoPorDia = computed((): HorarioPorDia[] => {
    const horarios = this.horariosDisponibles().filter(h => h.modalidad === 'reducido');
    return this.agruparPorDia(horarios);
  });

  horariosParaMostrar = computed((): HorarioPorDia[] => {
    const tipo = this.formulario().tipoGrupo;
    if (tipo === 'focus') {
      return this.horariosFocusPorDia();
    } else if (tipo === 'reducido') {
      return this.horariosReducidoPorDia();
    } else {
      const focus = this.horariosFocusPorDia();
      const reducido = this.horariosReducidoPorDia();
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

    const { data: usuariosData, error: usuariosError } = await client
      .from('usuarios')
      .select('id, telefono, nombre, rol, activo, creado_en')
      .order('nombre');

    if (usuariosError) {
      this.error.set('Error al cargar los usuarios.');
      return;
    }

    const { data: planesData } = await client
      .from('plan_usuario')
      .select('usuario_id, tipo_grupo, clases_focus, clases_reducido, clases_por_mes'); // Fetch new fields

    const planesMap = new Map<string, { tipo_grupo: string, clases_focus: number, clases_reducido: number, clases_por_mes: number }>();
    if (planesData) {
      for (const plan of planesData) {
        planesMap.set(plan.usuario_id, {
          tipo_grupo: plan.tipo_grupo,
          clases_focus: plan.clases_focus,
          clases_reducido: plan.clases_reducido,
          clases_por_mes: plan.clases_por_mes,
        });
      }
    }

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

    const usuarios: Usuario[] = (usuariosData || []).map((u) => {
      const plan = planesMap.get(u.id);
      return {
        id: u.id,
        telefono: u.telefono || '',
        nombre: u.nombre || '',
        rol: u.rol,
        activo: u.activo,
        creado_en: u.creado_en,
        tipo_grupo: plan?.tipo_grupo,
        clases_focus: plan?.clases_focus,
        clases_reducido: plan?.clases_reducido,
        clases_por_mes: plan?.clases_por_mes,
        horarios_fijos: horariosMap.get(u.id) || [],
      };
    });

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
      clasesFocus: 1,
      clasesReducido: 1,
      clasesPorMes: 0, // Initialize new field
      password: '',
      horariosSeleccionados: [],
    });
    this.errorModal.set(null);
    this.exitoModal.set(null);
    this.passwordCopiada.set(false);

    // Reset Calendar State
    this.vistaAsignacion.set('semana');
    this.fechaCalendario.set(new Date());
    this.reservasSeleccionadas.set(new Set());
    this.cargarSesionesMes(); // Load just in case user switches

    this.mostrarModal.set(true);
  }

  abrirModalEditar(usuario: Usuario) {
    this.modoEdicion.set(true);
    this.usuarioEditandoId.set(usuario.id);

    const partes = (usuario.nombre || '').split(' ');
    const nombre = partes[0] || '';
    const apellidos = partes.slice(1).join(' ') || '';

    const horariosSeleccionados = (usuario.horarios_fijos || []).map(h => h.horario_disponible_id);

    this.formulario.set({
      nombre: nombre,
      apellidos: apellidos,
      telefono: usuario.telefono,
      rol: usuario.rol as 'cliente' | 'profesor' | 'admin',
      activo: usuario.activo,
      tipoGrupo: (usuario.tipo_grupo as FormularioUsuario['tipoGrupo']) || 'focus',
      clasesFocus: usuario.clases_focus || 1,
      clasesReducido: usuario.clases_reducido || 1,
      clasesPorMes: usuario.clases_por_mes || 0,
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
      this.mostrarExitoGlobal(`Usuario ${usuario.nombre} eliminado`);
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
      this.formulario.update((f) => ({ ...f, horariosSeleccionados: [] }));
      // Reset vista to weekly view and clear calendar selections
      this.vistaAsignacion.set('semana');
      this.reservasSeleccionadas.set(new Set());
    }
  }

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

  onHorarioKeydown(event: KeyboardEvent, horarioId: number) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.toggleHorario(horarioId);
    }
  }

  isHorarioSeleccionado(horarioId: number): boolean {
    return this.formulario().horariosSeleccionados.includes(horarioId);
  }

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


  // Helper para mostrar feedback global
  private mostrarExitoGlobal(mensaje: string) {
    this.mensajeFeedback.set(mensaje);
    this.mostrarFeedback.set(true);

    // Auto-cerrar a los 3 segundos
    setTimeout(() => {
      this.mostrarFeedback.set(false);
    }, 3000);
  }

  // Métodos del Calendario de Asignación
  async cargarSesionesMes() {
    this.cargandoSesiones.set(true);
    const client = supabase();
    const fecha = this.fechaCalendario();
    const start = format(startOfMonth(fecha), 'yyyy-MM-dd');
    const end = format(endOfMonth(fecha), 'yyyy-MM-dd');

    const { data, error } = await client
      .from('sesiones')
      .select('id, fecha, hora, modalidad, capacidad')
      .gte('fecha', start)
      .lte('fecha', end)
      .eq('cancelada', false);

    if (error) {
      console.error('Error cargando sesiones:', error);
    } else {
      const sesionIds = data.map(s => s.id);
      let countsMap = new Map<number, number>();

      if (sesionIds.length > 0) {
        const { data: reservas } = await client
          .from('reservas')
          .select('sesion_id')
          .in('sesion_id', sesionIds)
          .eq('estado', 'activa');

        if (reservas) {
          for (const r of reservas) {
            countsMap.set(r.sesion_id, (countsMap.get(r.sesion_id) || 0) + 1);
          }
        }
      }

      this.sesionesMes.set(data.map(s => ({
        id: s.id,
        fecha: s.fecha,
        hora: s.hora,
        modalidad: s.modalidad as 'focus' | 'reducido',
        capacidad: s.capacidad,
        ocupadas: countsMap.get(s.id) || 0
      })));
    }
    this.cargandoSesiones.set(false);
  }

  cambiarMes(delta: number) {
    this.fechaCalendario.update(d => delta > 0 ? addMonths(d, delta) : subMonths(d, Math.abs(delta)));
    this.cargarSesionesMes();
  }

  toggleReserva(sesionId: number) {
    this.reservasSeleccionadas.update(set => {
      const newSet = new Set(set);
      if (newSet.has(sesionId)) {
        newSet.delete(sesionId);
      } else {
        newSet.add(sesionId);
      }
      return newSet;
    });
  }

  isReservaSeleccionada(sesionId: number): boolean {
    return this.reservasSeleccionadas().has(sesionId);
  }

  formularioValido(): boolean {
    const f = this.formulario();
    const tieneNombre = f.nombre.trim().length > 0;
    const tieneTelefono = f.telefono.trim().length >= 9;

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

    if (f.rol === 'cliente') {
      await client.from('plan_usuario').insert({
        usuario_id: userId,
        tipo_grupo: f.tipoGrupo,
        clases_focus: f.tipoGrupo === 'hibrido' ? f.clasesFocus : 0,
        clases_reducido: f.tipoGrupo === 'hibrido' ? f.clasesReducido : 0,
        activo: true,
      });

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

      // 4. Crear Reservas Manuales (si hay seleccionadas en Vista Mes)
      const reservasIds = Array.from(this.reservasSeleccionadas());
      if (reservasIds.length > 0) {
        const reservasInsert = reservasIds.map(sesionId => ({
          sesion_id: sesionId,
          usuario_id: userId,
          estado: 'activa',
          es_recuperacion: false,
          es_desde_horario_fijo: false
        }));

        const { error: reservasError } = await client
          .from('reservas')
          .insert(reservasInsert);

        if (reservasError) {
          console.error('Error creando reservas manuales:', reservasError);
          // Warning modal? Or just log.
        }
      }
    }

    this.mostrarExitoGlobal(`Usuario creado: ${nombre}`);

    // Limpiar formulario pero mantener modal abierto
    this.formulario.set({
      nombre: '',
      apellidos: '',
      telefono: '',
      rol: 'cliente',
      activo: true,
      tipoGrupo: 'focus',
      clasesFocus: 1,
      clasesReducido: 1,
      clasesPorMes: 0,
      password: '',
      horariosSeleccionados: [],
    });
    this.passwordCopiada.set(false);

    try {
      await this.sincronizarReservasUsuario(userId);
    } catch (err) {
      console.error('Error sincronizando reservas:', err);
    } finally {
      this.guardando.set(false);
    }
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

    if (f.rol === 'cliente') {
      const { data: planExistente } = await client
        .from('plan_usuario')
        .select('usuario_id')
        .eq('usuario_id', userId)
        .single();

      if (planExistente) {
        await client
          .from('plan_usuario')
          .update({
            tipo_grupo: f.tipoGrupo,
            clases_focus: f.tipoGrupo === 'hibrido' ? f.clasesFocus : 0,
            clases_reducido: f.tipoGrupo === 'hibrido' ? f.clasesReducido : 0,
            clases_por_mes: f.tipoGrupo === 'especial' ? f.clasesPorMes : 0,
          })
          .eq('usuario_id', userId);
      } else {
        await client.from('plan_usuario').insert({
          usuario_id: userId,
          tipo_grupo: f.tipoGrupo,
          clases_focus: f.tipoGrupo === 'hibrido' ? f.clasesFocus : 0,
          clases_reducido: f.tipoGrupo === 'hibrido' ? f.clasesReducido : 0,
          clases_por_mes: f.tipoGrupo === 'especial' ? f.clasesPorMes : 0,
          activo: true,
        });
      }

      await client
        .from('horario_fijo_usuario')
        .delete()
        .eq('usuario_id', userId);

      if (f.horariosSeleccionados.length > 0) {
        const horariosInsert = f.horariosSeleccionados.map(horarioId => ({
          usuario_id: userId,
          horario_disponible_id: horarioId,
          activo: true,
        }));

        await client.from('horario_fijo_usuario').insert(horariosInsert);
      }
    }

    if (f.password && f.password.length >= 6) {
      const passResult = await this.authService.cambiarPassword(userId, f.password);
      if (!passResult.success) {
        this.errorModal.set('Usuario actualizado pero error al cambiar contraseña.');
        await this.cargarUsuarios();
        return;
      }
    }

    // Sincronizar reservas si es cliente
    if (f.rol === 'cliente') {
      try {
        await this.sincronizarReservasUsuario(userId);
      } catch (err) {
        console.error('Error sincronizando reservas:', err);
      }
    }

    // Mostrar feedback y cerrar modal
    this.mostrarExitoGlobal('Usuario actualizado correctamente');
    this.cerrarModal();

    await this.cargarUsuarios();
  }

  private async sincronizarReservasUsuario(userId: string) {
    const client = supabase();

    // 1. Obtener horarios fijos
    const { data: horariosFijos, error: hError } = await client
      .from('horario_fijo_usuario')
      .select(`
        id, 
        horario_disponible_id,
        horarios_disponibles (
          dia_semana, 
          hora,
          modalidad
        )
      `)
      .eq('usuario_id', userId)
      .eq('activo', true);

    if (hError || !horariosFijos) return;

    // Mapa de horarios deseados: "dia-hora-modalidad"
    const horariosMap = new Set<string>();
    horariosFijos.forEach((hf) => {
      const hd = hf.horarios_disponibles as any;
      if (hd) {
        const horaSimple = hd.hora.slice(0, 5);
        // IMPORTANTE: Incluir modalidad en la clave para evitar cruces
        horariosMap.add(`${hd.dia_semana}-${horaSimple}-${hd.modalidad}`);
      }
    });

    // 2. Obtener meses abiertos
    const { data: mesesAbiertos } = await client
      .from('agenda_mes')
      .select('anio, mes')
      .eq('abierto', true);

    if (!mesesAbiertos || mesesAbiertos.length === 0) return;

    // 3. Obtener sesiones futuras
    const hoyStr = new Date().toISOString().split('T')[0];

    const { data: sesionesFuturas, error: sError } = await client
      .from('sesiones')
      .select('id, fecha, hora, modalidad')
      .gte('fecha', hoyStr)
      .eq('cancelada', false);

    if (sError || !sesionesFuturas) return;

    // 4. Filtrar sesiones coincidentes con el nuevo plan
    const sesionesA_Reservar: any[] = [];
    // IDs de sesiones que deberían estar reservadas
    const idsSesionesDeseadas = new Set<number>();

    for (const sesion of sesionesFuturas) {
      const d = new Date(sesion.fecha);
      const jsDay = d.getDay();
      const sistemaDia = jsDay === 0 ? 7 : jsDay; // 1=Lun ... 7=Dom

      // Verificar si el mes está abierto
      const mesSesion = d.getMonth() + 1;
      const anioSesion = d.getFullYear();
      const mesAbierto = mesesAbiertos.some((m) => m.anio === anioSesion && m.mes === mesSesion);

      if (!mesAbierto) continue;

      const horaSimple = sesion.hora.slice(0, 5);
      // Clave debe coincidir exactamente con la generada arriba (dia-hora-modalidad)
      const key = `${sistemaDia}-${horaSimple}-${sesion.modalidad}`;

      if (horariosMap.has(key)) {
        sesionesA_Reservar.push(sesion);
        idsSesionesDeseadas.add(sesion.id);
      }
    }

    // 5. LIMPIEZA: Eliminar reservas futuras que NO coinciden con el nuevo plan
    // Solo eliminamos reservas activas, generadas automáticamente ("es_desde_horario_fijo"), 
    // que estén en meses abiertos y que ya no estén en el plan deseado.

    // Obtener reservas futuras del usuario
    const { data: reservasFuturasExistentes } = await client
      .from('reservas')
      .select('id, sesion_id, es_desde_horario_fijo, estado')
      .eq('usuario_id', userId)
      .gte('created_at', '2020-01-01') // Filtro dummy para asegurar uso de índice si existe
      .eq('estado', 'activa');

    // Filtramos manualmente las reservas asociadas a las sesiones futuras cargadas
    if (reservasFuturasExistentes && sesionesFuturas.length > 0) {
      const mapSesionesFuturas = new Map(sesionesFuturas.map(s => [s.id, s]));
      const reservasAEliminar: number[] = [];

      for (const r of reservasFuturasExistentes) {
        // Solo verificamos si la reserva está asociada a una sesión futura de las que cargamos
        // (es decir, sesiones activas a partir de hoy)
        const sesionAsociada = mapSesionesFuturas.get(r.sesion_id);

        if (sesionAsociada) {
          // Si la sesión no está en el nuevo plan deseado
          if (!idsSesionesDeseadas.has(r.sesion_id)) {
            // Y si fue generada automáticamente O si queremos ser estrictos con el plan,
            // eliminamos la reserva. 
            // En este caso, asumimos que si cambias el plan, quieres que se ajuste todo.
            // Para mayor seguridad, podríamos mirar 'es_desde_horario_fijo', pero 
            // como había un bug, muchas no lo tendrán marcado.
            // Así que eliminamos cualquier reserva futura que no encaje en el nuevo horario fijo
            // PERO cuidado con días sueltos/recuperaciones.

            // Estrategia segura: Eliminar si es_desde_horario_fijo es true
            // O si la modalidad no coincide con ninguna del nuevo plan (para limpiar basura).

            // Dado el problema actual, vamos a eliminarla si no está en idsSesionesDeseadas.
            // Esto limpiará "ruido". Si el usuario hizo un cambio manual a otro día, 
            // se perderá si no está en el horario fijo. Es un trade-off aceptable al "Resetear" plan.
            reservasAEliminar.push(r.id);
          }
        }
      }

      if (reservasAEliminar.length > 0) {
        console.log(`Eliminando ${reservasAEliminar.length} reservas obsoletas...`);
        await client.from('reservas').delete().in('id', reservasAEliminar);
      }
    }

    if (sesionesA_Reservar.length === 0) return;

    // 6. Verificar existentes para no duplicar
    const idsSesiones = sesionesA_Reservar.map((s) => s.id);
    const { data: reservasExistentes } = await client
      .from('reservas')
      .select('sesion_id')
      .eq('usuario_id', userId)
      .in('sesion_id', idsSesiones);

    const setReservadas = new Set(reservasExistentes?.map((r) => r.sesion_id));

    const nuevasReservas = sesionesA_Reservar
      .filter((s) => !setReservadas.has(s.id))
      .map((s) => ({
        usuario_id: userId,
        sesion_id: s.id,
        estado: 'activa',
        es_desde_horario_fijo: true // Marcamos que viene del automático
      }));

    if (nuevasReservas.length > 0) {
      await client.from('reservas').insert(nuevasReservas);
    }
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

  getMesActual(): string {
    const fecha = this.fechaCalendario();
    return format(fecha, 'MMMM yyyy', { locale: es });
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
    if (tipo === 'focus') return 'avatar-focus plan-focus';
    if (tipo === 'reducido') return 'avatar-reducido plan-reducido';
    if (tipo === 'hibrido') return 'avatar-hibrido plan-hibrido';
    if (tipo === 'especial') return 'avatar-especial plan-especial';
    return 'avatar-sin-plan';
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
    this.location.back();
  }
}