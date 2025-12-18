// src/app/components/reservas/reserva-cita.component.ts
// NUEVO SISTEMA: Este componente ahora es para RECUPERAR CLASES
// Los alumnos tienen clases fijas asignadas, este es para usar recuperaciones

import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/auth.service';
import { supabase } from '../../core/supabase.client';

type Modalidad = 'focus' | 'reducido';

interface Sesion {
  id: number;
  fecha: string;
  hora: string;
  modalidad: Modalidad;
  capacidad: number;
  plazas_ocupadas: number;
  plazas_disponibles: number;
  estado: 'disponible' | 'completa' | 'pasada';
  en_lista_espera: boolean;
}

interface Recuperacion {
  id: number;
  modalidad: Modalidad;
  mes_origen: number;
  anio_origen: number;
  mes_limite: number;
  anio_limite: number;
  motivo: string;
}

interface DiaAgrupado {
  fecha: string;
  diaNombre: string;
  fechaFormateada: string;
  sesiones: Sesion[];
}

interface SemanaAgrupada {
  numeroSemana: number;
  tituloSemana: string;
  dias: DiaAgrupado[];
}

@Component({
  standalone: true,
  selector: 'app-reserva-cita',
  imports: [CommonModule, FormsModule],
  templateUrl: './reserva-cita.component.html',
  styleUrls: ['./reserva-cita.component.scss'],
})
export class ReservaCitaComponent implements OnInit {
  private router = inject(Router);
  private auth = inject(AuthService);

  cargando = signal(true);
  error = signal<string | null>(null);
  mensajeExito = signal<string | null>(null);
  guardando = signal(false);

  // Navegación de meses
  mesActual = signal({ anio: new Date().getFullYear(), mes: new Date().getMonth() + 1 });
  mesAbierto = signal(false);

  // Datos
  sesiones = signal<Sesion[]>([]);
  recuperaciones = signal<Recuperacion[]>([]);
  sesionSeleccionada = signal<Sesion | null>(null);
  modalidad = signal<Modalidad>('focus');
  tipoGrupo = signal<string>('focus');

  esAdmin = computed(() => this.auth.getRol() === 'admin');

  nombreMes = computed(() => {
    const { anio, mes } = this.mesActual();
    const fecha = new Date(anio, mes - 1, 1);
    const nombreMes = fecha.toLocaleDateString('es-ES', { month: 'long' });
    return `${nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1)} ${anio}`;
  });

  // Recuperaciones filtradas por modalidad actual
  recuperacionesModalidad = computed(() => {
    const mod = this.modalidad();
    return this.recuperaciones().filter(r => r.modalidad === mod);
  });

  tieneRecuperacion = computed(() => {
    return this.recuperacionesModalidad().length > 0;
  });

  // Modalidades disponibles según tipo de grupo
  modalidadesDisponibles = computed((): Modalidad[] => {
    const tipo = this.tipoGrupo();
    if (tipo === 'focus') return ['focus'];
    if (tipo === 'reducido') return ['reducido'];
    return ['focus', 'reducido']; // hibrido o especial
  });

  // Sesiones agrupadas por semanas
  semanasAgrupadas = computed((): SemanaAgrupada[] => {
    const mod = this.modalidad();
    const sesionesFiltradas = this.sesiones().filter(
      s => s.modalidad === mod && s.estado !== 'pasada'
    );

    if (sesionesFiltradas.length === 0) return [];

    // Agrupar sesiones por fecha
    const sesionesPorFecha = new Map<string, Sesion[]>();
    sesionesFiltradas.forEach(sesion => {
      const fecha = sesion.fecha;
      if (!sesionesPorFecha.has(fecha)) {
        sesionesPorFecha.set(fecha, []);
      }
      sesionesPorFecha.get(fecha)!.push(sesion);
    });

    const fechasConSesiones = Array.from(sesionesPorFecha.keys()).sort();
    if (fechasConSesiones.length === 0) return [];

    const semanas: SemanaAgrupada[] = [];
    let numeroSemana = 1;

    const getLunes = (fecha: string): Date => {
      const d = new Date(fecha + 'T12:00:00');
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      return new Date(d.setDate(diff));
    };

    const primerLunes = getLunes(fechasConSesiones[0]);
    const ultimaFechaConSesion = new Date(fechasConSesiones[fechasConSesiones.length - 1] + 'T12:00:00');
    const currentLunes = new Date(primerLunes);

    while (currentLunes <= ultimaFechaConSesion) {
      const currentViernes = new Date(currentLunes);
      currentViernes.setDate(currentViernes.getDate() + 4);

      const semanaActual: DiaAgrupado[] = [];

      for (let i = 0; i < 5; i++) {
        const diaFecha = new Date(currentLunes);
        diaFecha.setDate(diaFecha.getDate() + i);
        const fechaStr = diaFecha.toISOString().split('T')[0];

        const dia: DiaAgrupado = {
          fecha: fechaStr,
          diaNombre: diaFecha.toLocaleDateString('es-ES', { weekday: 'short' }),
          fechaFormateada: diaFecha.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }),
          sesiones: sesionesPorFecha.get(fechaStr) || [],
        };

        semanaActual.push(dia);
      }

      const tieneSesiones = semanaActual.some(d => d.sesiones.length > 0);

      if (tieneSesiones) {
        const primerDia = currentLunes.getDate();
        const ultimoDia = currentViernes.getDate();
        const mes = currentLunes.toLocaleDateString('es-ES', { month: 'short' });

        semanas.push({
          numeroSemana,
          tituloSemana: `Semana del ${primerDia} al ${ultimoDia} ${mes}`,
          dias: semanaActual,
        });

        numeroSemana++;
      }

      currentLunes.setDate(currentLunes.getDate() + 7);
    }

    return semanas;
  });

  ngOnInit() {
    if (this.esAdmin()) {
      this.router.navigateByUrl('/dashboard');
      return;
    }
    this.cargarDatos();
  }

  async cargarDatos() {
    this.cargando.set(true);
    this.error.set(null);

    try {
      await this.verificarMesAbierto();
      
      if (this.mesAbierto()) {
        await Promise.all([
          this.cargarTipoGrupo(),
          this.cargarRecuperaciones(),
          this.cargarSesionesDisponibles(),
        ]);
      }
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error al cargar datos.');
    } finally {
      this.cargando.set(false);
    }
  }

  async verificarMesAbierto() {
    const { anio, mes } = this.mesActual();

    const { data } = await supabase()
      .from('agenda_mes')
      .select('abierto')
      .eq('anio', anio)
      .eq('mes', mes)
      .single();

    this.mesAbierto.set(data?.abierto ?? false);
  }

  async cargarTipoGrupo() {
    const userId = this.auth.userId();
    if (!userId) return;

    const { data } = await supabase()
      .from('plan_usuario')
      .select('tipo_grupo')
      .eq('usuario_id', userId)
      .single();

    if (data?.tipo_grupo) {
      this.tipoGrupo.set(data.tipo_grupo);
      
      // Establecer modalidad inicial
      if (data.tipo_grupo === 'reducido') {
        this.modalidad.set('reducido');
      } else {
        this.modalidad.set('focus');
      }
    }
  }

  async cargarRecuperaciones() {
    const userId = this.auth.userId();
    if (!userId) return;

    const { data, error } = await supabase()
      .rpc('obtener_recuperaciones_usuario', { p_usuario_id: userId });

    if (error) {
      console.error('Error cargando recuperaciones:', error);
      return;
    }

    this.recuperaciones.set(data || []);
  }

  async cargarSesionesDisponibles() {
    const userId = this.auth.userId();
    if (!userId) return;

    const { anio, mes } = this.mesActual();

    // Obtener sesiones con disponibilidad
    const { data: sesionesData, error } = await supabase()
      .from('vista_sesiones_disponibilidad')
      .select('*')
      .gte('fecha', `${anio}-${mes.toString().padStart(2, '0')}-01`)
      .lt('fecha', mes === 12 ? `${anio + 1}-01-01` : `${anio}-${(mes + 1).toString().padStart(2, '0')}-01`)
      .eq('cancelada', false)
      .order('fecha')
      .order('hora');

    if (error) {
      console.error('Error cargando sesiones:', error);
      return;
    }

    // Obtener en qué sesiones está en lista de espera
    const { data: listaEsperaData } = await supabase()
      .from('lista_espera')
      .select('sesion_id')
      .eq('usuario_id', userId);

    const enListaEspera = new Set((listaEsperaData || []).map(l => l.sesion_id));

    // Obtener sesiones donde ya tiene reserva activa
    const { data: reservasData } = await supabase()
      .from('reservas')
      .select('sesion_id')
      .eq('usuario_id', userId)
      .eq('estado', 'activa');

    const tieneReserva = new Set((reservasData || []).map(r => r.sesion_id));

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const sesiones: Sesion[] = (sesionesData || [])
      .filter(s => !tieneReserva.has(s.sesion_id)) // Excluir donde ya tiene reserva
      .map(s => {
        const fechaSesion = new Date(s.fecha + 'T' + s.hora);
        const esPasada = fechaSesion < hoy;

        let estado: Sesion['estado'];
        if (esPasada) {
          estado = 'pasada';
        } else if (s.plazas_disponibles <= 0) {
          estado = 'completa';
        } else {
          estado = 'disponible';
        }

        return {
          id: s.sesion_id,
          fecha: s.fecha,
          hora: s.hora.slice(0, 5),
          modalidad: s.modalidad as Modalidad,
          capacidad: s.capacidad,
          plazas_ocupadas: s.plazas_ocupadas,
          plazas_disponibles: s.plazas_disponibles,
          estado,
          en_lista_espera: enListaEspera.has(s.sesion_id),
        };
      });

    this.sesiones.set(sesiones);
  }

  // Navegación de meses
  mesAnterior() {
    const { anio, mes } = this.mesActual();
    if (mes === 1) {
      this.mesActual.set({ anio: anio - 1, mes: 12 });
    } else {
      this.mesActual.set({ anio, mes: mes - 1 });
    }
    this.sesionSeleccionada.set(null);
    this.cargarDatos();
  }

  mesSiguiente() {
    const { anio, mes } = this.mesActual();
    if (mes === 12) {
      this.mesActual.set({ anio: anio + 1, mes: 1 });
    } else {
      this.mesActual.set({ anio, mes: mes + 1 });
    }
    this.sesionSeleccionada.set(null);
    this.cargarDatos();
  }

  selectModalidad(mod: Modalidad) {
    this.modalidad.set(mod);
    this.sesionSeleccionada.set(null);
  }

  selectSesion(sesion: Sesion) {
    if (sesion.estado === 'pasada') return;

    if (this.sesionSeleccionada()?.id === sesion.id) {
      this.sesionSeleccionada.set(null);
    } else {
      this.sesionSeleccionada.set(sesion);
    }
  }

  puedeToggleModalidad(): boolean {
    return this.modalidadesDisponibles().length > 1;
  }

  // Usar recuperación para tomar un hueco
  async usarRecuperacion() {
    const sesion = this.sesionSeleccionada();
    if (!sesion) return;

    const userId = this.auth.userId();
    if (!userId) return;

    this.guardando.set(true);
    this.error.set(null);
    this.mensajeExito.set(null);

    try {
      const { data, error } = await supabase().rpc('usar_recuperacion', {
        p_usuario_id: userId,
        p_sesion_id: sesion.id,
      });

      if (error) {
        this.error.set(error.message);
        return;
      }

      if (data && data.length > 0) {
        const resultado = data[0];
        if (resultado.ok) {
          this.mensajeExito.set('¡Clase recuperada correctamente!');
          this.sesionSeleccionada.set(null);
          await this.cargarDatos();
        } else {
          this.error.set(resultado.mensaje);
        }
      }
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error al procesar la recuperación.');
    } finally {
      this.guardando.set(false);
    }
  }

  // Lista de espera
  async toggleListaEspera(sesion: Sesion) {
    const userId = this.auth.userId();
    if (!userId) return;

    this.guardando.set(true);
    this.error.set(null);

    try {
      if (sesion.en_lista_espera) {
        // Quitar de lista de espera
        const { data, error } = await supabase().rpc('quitar_lista_espera', {
          p_usuario_id: userId,
          p_sesion_id: sesion.id,
        });

        if (error) {
          this.error.set(error.message);
          return;
        }

        if (data?.[0]?.ok) {
          this.mensajeExito.set('Eliminado de la lista de espera.');
          await this.cargarSesionesDisponibles();
        } else {
          this.error.set(data?.[0]?.mensaje || 'Error al quitar de lista de espera.');
        }
      } else {
        // Añadir a lista de espera
        const { data, error } = await supabase().rpc('apuntarse_lista_espera', {
          p_usuario_id: userId,
          p_sesion_id: sesion.id,
        });

        if (error) {
          this.error.set(error.message);
          return;
        }

        if (data?.[0]?.ok) {
          this.mensajeExito.set('Añadido a la lista de espera. Te notificaremos si hay hueco.');
          await this.cargarSesionesDisponibles();
        } else {
          this.error.set(data?.[0]?.mensaje || 'Error al añadir a lista de espera.');
        }
      }
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error al procesar lista de espera.');
    } finally {
      this.guardando.set(false);
    }
  }

  getEstadoClase(sesion: Sesion): string {
    const seleccionada = this.sesionSeleccionada()?.id === sesion.id;
    if (seleccionada) return 'slot-btn--selected';
    if (sesion.estado === 'pasada') return 'slot-btn--pasada';
    if (sesion.en_lista_espera) return 'slot-btn--lista-espera';
    if (sesion.estado === 'completa') return 'slot-btn--completa';
    return 'slot-btn--disponible';
  }

  getEstadoTexto(sesion: Sesion): string {
    if (sesion.estado === 'pasada') return 'Pasada';
    if (sesion.en_lista_espera) return 'En espera';
    if (sesion.estado === 'completa') return 'Completa';
    return `${sesion.plazas_disponibles} plaza${sesion.plazas_disponibles !== 1 ? 's' : ''}`;
  }

  getNombreModalidad(mod: Modalidad): string {
    return mod === 'focus' ? 'Focus' : 'Reducido';
  }

  formatearMesRecuperacion(mes: number, anio: number): string {
    const fecha = new Date(anio, mes - 1, 1);
    return fecha.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  }

  obtenerNombreDia(fecha: string): string {
    const d = new Date(fecha + 'T12:00:00');
    return d.toLocaleDateString('es-ES', { weekday: 'long' });
  }

  formatearFecha(fecha: string): string {
    const d = new Date(fecha + 'T12:00:00');
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
  }

  volver() {
    this.router.navigateByUrl('/dashboard');
  }
}