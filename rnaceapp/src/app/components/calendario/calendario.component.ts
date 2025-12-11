// src/app/components/calendario/calendario.component.ts
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { supabase } from '../../core/supabase.client';

interface DiaCalendario {
  fecha: string; // YYYY-MM-DD
  dia: number; // 1-31
  diaSemana: number; // 0-6 (0=domingo)
  esDelMes: boolean;
  esHoy: boolean;
  esLaborable: boolean; // lunes-viernes
  esFestivo: boolean;
  mesAbierto: boolean;
  reservas: ReservaCalendario[];
}

interface ReservaCalendario {
  id: number;
  sesion_id: number;
  usuario_nombre: string;
  usuario_telefono: string;
  hora: string;
  modalidad: 'focus' | 'reducido';
  estado: string;
  es_propia: boolean; // true si es del usuario actual
}

interface MesAgenda {
  anio: number;
  mes: number;
  abierto: boolean;
}

// Interfaz para la respuesta de Supabase
interface ReservaDB {
  id: number;
  sesion_id: number;
  usuario_id: string;
  estado: string;
  sesiones:
    | {
        fecha_inicio: string;
        modalidad: string;
      }[]
    | null;
  usuario_nombre?: string;
  usuario_telefono?: string;
}

interface UsuarioDB {
  id: string;
  nombre: string;
  telefono: string;
}

@Component({
  standalone: true,
  selector: 'app-calendario',
  imports: [CommonModule],
  templateUrl: './calendario.component.html',
  styleUrls: ['./calendario.component.scss'],
})
export class CalendarioComponent implements OnInit {
  private router = inject(Router);
  private auth = inject(AuthService);

  // Estado
  cargando = signal(true);
  guardando = signal(false);
  error = signal<string | null>(null);
  mensajeExito = signal<string | null>(null);

  // Fecha actual del calendario
  anioActual = signal(new Date().getFullYear());
  mesActual = signal(new Date().getMonth() + 1); // 1-12

  // Datos
  diasCalendario = signal<DiaCalendario[]>([]);
  mesAgenda = signal<MesAgenda | null>(null);
  festivosSeleccionados = signal<Set<string>>(new Set()); // Set de fechas YYYY-MM-DD

  // Usuario
  esAdmin = computed(() => this.auth.getRol() === 'admin');
  userId = computed(() => this.auth.userId());

  // Modo edición (solo admin)
  modoEdicion = signal(false);

  // Computed
  nombreMes = computed(() => {
    const fecha = new Date(this.anioActual(), this.mesActual() - 1, 1);
    const nombreMes = fecha.toLocaleDateString('es-ES', { month: 'long' });
    const anio = this.anioActual();
    return `${nombreMes} ${anio}`; // Sin "de"
  });

  mesEstaAbierto = computed(() => this.mesAgenda()?.abierto ?? false);

  diasSemana = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  // Resumen de reservas (solo admin)
  totalReservas = computed(() => {
    return this.diasCalendario().reduce((total, dia) => total + dia.reservas.length, 0);
  });

  reservasPorModalidad = computed(() => {
    let focus = 0;
    let reducido = 0;

    this.diasCalendario().forEach((dia) => {
      dia.reservas.forEach((r) => {
        if (r.modalidad === 'focus') focus++;
        else reducido++;
      });
    });

    return { focus, reducido };
  });

  ngOnInit() {
    this.cargarCalendario();
  }

  // ========== CARGA DE DATOS ==========

  async cargarCalendario() {
    this.cargando.set(true);
    this.error.set(null);
    this.mensajeExito.set(null);

    try {
      const anio = this.anioActual();
      const mes = this.mesActual();
      const client = supabase();

      // 1. Cargar estado del mes (agenda_mes)
      const { data: agendaData } = await client
        .from('agenda_mes')
        .select('*')
        .eq('anio', anio)
        .eq('mes', mes)
        .maybeSingle();

      this.mesAgenda.set(agendaData || { anio, mes, abierto: false });

      // 2. Cargar festivos del mes
      const primerDia = `${anio}-${mes.toString().padStart(2, '0')}-01`;
      const ultimoDia = new Date(anio, mes, 0).toISOString().split('T')[0];

      const { data: festivosData } = await client
        .from('festivos')
        .select('fecha')
        .gte('fecha', primerDia)
        .lte('fecha', ultimoDia);

      const festivosSet = new Set<string>();
      (festivosData || []).forEach((f) => festivosSet.add(f.fecha));

      // 3. Cargar reservas del mes
      let reservasData: ReservaDB[] = [];

      if (this.esAdmin()) {
        // Admin ve todas las reservas
        const { data } = await client
          .from('reservas')
          .select(
            `
            id,
            sesion_id,
            usuario_id,
            estado,
            sesiones (
              fecha_inicio,
              modalidad
            )
          `,
          )
          .gte('sesiones.fecha_inicio', primerDia)
          .lte('sesiones.fecha_inicio', ultimoDia + 'T23:59:59')
          .eq('estado', 'activa')
          .order('sesiones(fecha_inicio)', { ascending: true });

        reservasData = (data as ReservaDB[]) || [];

        // Cargar nombres de usuarios
        const userIds = [...new Set(reservasData.map((r) => r.usuario_id))];
        if (userIds.length > 0) {
          const { data: usuariosData } = await client
            .from('usuarios')
            .select('id, nombre, telefono')
            .in('id', userIds);

          const usuariosMap = new Map<string, { nombre: string; telefono: string }>();
          ((usuariosData as UsuarioDB[]) || []).forEach((u) => {
            usuariosMap.set(u.id, { nombre: u.nombre, telefono: u.telefono });
          });

          reservasData = reservasData.map((r) => ({
            ...r,
            usuario_nombre: usuariosMap.get(r.usuario_id)?.nombre || 'Sin nombre',
            usuario_telefono: usuariosMap.get(r.usuario_id)?.telefono || '',
          }));
        }
      } else {
        // Cliente solo ve sus reservas
        const uid = this.userId();
        if (uid) {
          const { data } = await client
            .from('reservas')
            .select(
              `
              id,
              sesion_id,
              usuario_id,
              estado,
              sesiones (
                fecha_inicio,
                modalidad
              )
            `,
            )
            .eq('usuario_id', uid)
            .gte('sesiones.fecha_inicio', primerDia)
            .lte('sesiones.fecha_inicio', ultimoDia + 'T23:59:59')
            .eq('estado', 'activa')
            .order('sesiones(fecha_inicio)', { ascending: true });

          reservasData = ((data as ReservaDB[]) || []).map((r) => ({
            ...r,
            usuario_nombre: this.auth.usuario()?.nombre || 'Tú',
            usuario_telefono: this.auth.usuario()?.telefono || '',
          }));
        }
      }

      // 4. Construir calendario
      const dias = this.construirDiasCalendario(anio, mes, festivosSet, reservasData);
      this.diasCalendario.set(dias);
    } catch (err) {
      console.error('Error cargando calendario:', err);
      this.error.set('Error al cargar el calendario.');
    } finally {
      this.cargando.set(false);
    }
  }

  private construirDiasCalendario(
    anio: number,
    mes: number,
    festivos: Set<string>,
    reservasData: ReservaDB[],
  ): DiaCalendario[] {
    const dias: DiaCalendario[] = [];
    const primerDia = new Date(anio, mes - 1, 1);
    const ultimoDia = new Date(anio, mes, 0);
    const hoy = new Date().toISOString().split('T')[0];
    const mesAbierto = this.mesAgenda()?.abierto ?? false;
    const userId = this.userId();

    // Agrupar reservas por fecha
    const reservasPorFecha = new Map<string, ReservaCalendario[]>();
    reservasData.forEach((r) => {
      // Verificar que sesiones existe y tiene al menos un elemento
      if (!r.sesiones || r.sesiones.length === 0) return;

      // Acceder al primer elemento del array de sesiones
      const sesion = r.sesiones[0];
      const fecha = sesion.fecha_inicio.split('T')[0];
      const hora = sesion.fecha_inicio.split('T')[1].substring(0, 5);

      const reserva: ReservaCalendario = {
        id: r.id,
        sesion_id: r.sesion_id,
        usuario_nombre: r.usuario_nombre || 'Desconocido',
        usuario_telefono: r.usuario_telefono || '',
        hora: hora,
        modalidad: sesion.modalidad as 'focus' | 'reducido',
        estado: r.estado,
        es_propia: r.usuario_id === userId,
      };

      if (!reservasPorFecha.has(fecha)) {
        reservasPorFecha.set(fecha, []);
      }
      reservasPorFecha.get(fecha)!.push(reserva);
    });

    // Días del mes anterior (para completar la primera semana)
    const primerDiaSemana = primerDia.getDay();
    if (primerDiaSemana > 0) {
      const mesAnterior = mes === 1 ? 12 : mes - 1;
      const anioAnterior = mes === 1 ? anio - 1 : anio;
      const ultimoDiaMesAnterior = new Date(anioAnterior, mesAnterior, 0).getDate();

      for (let i = primerDiaSemana - 1; i >= 0; i--) {
        const dia = ultimoDiaMesAnterior - i;
        const fecha = `${anioAnterior}-${mesAnterior.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;

        dias.push({
          fecha,
          dia,
          diaSemana: new Date(fecha).getDay(),
          esDelMes: false,
          esHoy: false,
          esLaborable: false,
          esFestivo: false,
          mesAbierto: false,
          reservas: [],
        });
      }
    }

    // Días del mes actual
    for (let dia = 1; dia <= ultimoDia.getDate(); dia++) {
      const fecha = `${anio}-${mes.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;
      const diaSemana = new Date(fecha).getDay();
      const esLaborable = diaSemana >= 1 && diaSemana <= 5; // Lunes a viernes
      const esFestivo = festivos.has(fecha);

      dias.push({
        fecha,
        dia,
        diaSemana,
        esDelMes: true,
        esHoy: fecha === hoy,
        esLaborable,
        esFestivo,
        mesAbierto,
        reservas: reservasPorFecha.get(fecha) || [],
      });
    }

    // Días del mes siguiente (para completar la última semana)
    const ultimoDiaSemana = ultimoDia.getDay();
    if (ultimoDiaSemana < 6) {
      const mesSiguiente = mes === 12 ? 1 : mes + 1;
      const anioSiguiente = mes === 12 ? anio + 1 : anio;

      for (let dia = 1; dia <= 6 - ultimoDiaSemana; dia++) {
        const fecha = `${anioSiguiente}-${mesSiguiente.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;

        dias.push({
          fecha,
          dia,
          diaSemana: new Date(fecha).getDay(),
          esDelMes: false,
          esHoy: false,
          esLaborable: false,
          esFestivo: false,
          mesAbierto: false,
          reservas: [],
        });
      }
    }

    return dias;
  }

  // ========== NAVEGACIÓN ==========

  mesAnterior() {
    if (this.mesActual() === 1) {
      this.mesActual.set(12);
      this.anioActual.update((a) => a - 1);
    } else {
      this.mesActual.update((m) => m - 1);
    }
    this.modoEdicion.set(false);
    this.festivosSeleccionados.set(new Set());
    this.cargarCalendario();
  }

  mesSiguiente() {
    if (this.mesActual() === 12) {
      this.mesActual.set(1);
      this.anioActual.update((a) => a + 1);
    } else {
      this.mesActual.update((m) => m + 1);
    }
    this.modoEdicion.set(false);
    this.festivosSeleccionados.set(new Set());
    this.cargarCalendario();
  }

  // ========== GESTIÓN DE MES (ADMIN) ==========

  activarModoEdicion() {
    if (!this.esAdmin()) return;

    // Cargar festivos existentes
    const festivosActuales = new Set<string>();
    this.diasCalendario().forEach((dia) => {
      if (dia.esFestivo && dia.esDelMes) {
        festivosActuales.add(dia.fecha);
      }
    });

    this.festivosSeleccionados.set(festivosActuales);
    this.modoEdicion.set(true);
    this.error.set(null);
    this.mensajeExito.set(null);
  }

  cancelarEdicion() {
    this.modoEdicion.set(false);
    this.festivosSeleccionados.set(new Set());
    this.error.set(null);
  }

  toggleFestivo(dia: DiaCalendario) {
    if (!this.modoEdicion() || !dia.esDelMes || !dia.esLaborable) return;

    const festivos = new Set(this.festivosSeleccionados());

    if (festivos.has(dia.fecha)) {
      festivos.delete(dia.fecha);
    } else {
      festivos.add(dia.fecha);
    }

    this.festivosSeleccionados.set(festivos);
  }

  esFestivoSeleccionado(fecha: string): boolean {
    return this.festivosSeleccionados().has(fecha);
  }

  async guardarYAbrirMes() {
    if (!this.esAdmin()) return;

    this.guardando.set(true);
    this.error.set(null);
    this.mensajeExito.set(null);

    try {
      const anio = this.anioActual();
      const mes = this.mesActual();
      const client = supabase();

      const primerDia = `${anio}-${mes.toString().padStart(2, '0')}-01`;
      const ultimoDia = new Date(anio, mes, 0).toISOString().split('T')[0];

      // 1. Eliminar festivos existentes del mes
      const { error: deleteError } = await client
        .from('festivos')
        .delete()
        .gte('fecha', primerDia)
        .lte('fecha', ultimoDia);

      if (deleteError) {
        console.error('Error eliminando festivos:', deleteError);
        this.error.set(`Error al limpiar festivos: ${deleteError.message}`);
        return;
      }

      // 2. Insertar nuevos festivos (si hay)
      const festivosArray = [...this.festivosSeleccionados()];

      if (festivosArray.length > 0) {
        const festivosInsert = festivosArray.map((fecha) => ({
          fecha,
          descripcion: 'Día festivo/cerrado',
        }));

        const { error: insertError } = await client.from('festivos').insert(festivosInsert);

        if (insertError) {
          console.error('Error insertando festivos:', insertError);
          this.error.set(`Error al guardar festivos: ${insertError.message}`);
          return;
        }
      }

      // 3. Abrir/actualizar el mes en agenda_mes
      // Primero verificamos si existe
      const { data: existente } = await client
        .from('agenda_mes')
        .select('anio, mes')
        .eq('anio', anio)
        .eq('mes', mes)
        .maybeSingle();

      if (existente) {
        // Actualizar
        const { error: updateError } = await client
          .from('agenda_mes')
          .update({ abierto: true })
          .eq('anio', anio)
          .eq('mes', mes);

        if (updateError) {
          console.error('Error actualizando agenda_mes:', updateError);
          this.error.set(`Error al abrir el mes: ${updateError.message}`);
          return;
        }
      } else {
        // Insertar
        const { error: insertError } = await client
          .from('agenda_mes')
          .insert({ anio, mes, abierto: true });

        if (insertError) {
          console.error('Error insertando agenda_mes:', insertError);
          this.error.set(`Error al abrir el mes: ${insertError.message}`);
          return;
        }
      }

      this.mensajeExito.set('Mes configurado correctamente. Los usuarios ya pueden reservar.');
      this.modoEdicion.set(false);
      this.festivosSeleccionados.set(new Set());

      // Recargar calendario
      await this.cargarCalendario();
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error inesperado al guardar.');
    } finally {
      this.guardando.set(false);
    }
  }

  async cerrarMes() {
    if (!this.esAdmin()) return;

    if (
      !confirm('¿Estás seguro de cerrar este mes? Los usuarios no podrán hacer nuevas reservas.')
    ) {
      return;
    }

    this.guardando.set(true);
    this.error.set(null);

    try {
      const anio = this.anioActual();
      const mes = this.mesActual();
      const client = supabase();

      // Verificar si existe el registro
      const { data: existente } = await client
        .from('agenda_mes')
        .select('anio, mes')
        .eq('anio', anio)
        .eq('mes', mes)
        .maybeSingle();

      if (existente) {
        const { error } = await client
          .from('agenda_mes')
          .update({ abierto: false })
          .eq('anio', anio)
          .eq('mes', mes);

        if (error) {
          this.error.set(`Error al cerrar el mes: ${error.message}`);
          return;
        }
      } else {
        const { error } = await client.from('agenda_mes').insert({ anio, mes, abierto: false });

        if (error) {
          this.error.set(`Error al cerrar el mes: ${error.message}`);
          return;
        }
      }

      this.mensajeExito.set('Mes cerrado. Los usuarios no pueden hacer nuevas reservas.');
      await this.cargarCalendario();
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error inesperado.');
    } finally {
      this.guardando.set(false);
    }
  }

  // ========== UTILIDADES ==========

  getDiaClases(dia: DiaCalendario): string {
    const clases = ['dia-celda'];

    if (!dia.esDelMes) clases.push('dia-celda--otro-mes');
    if (dia.esHoy) clases.push('dia-celda--hoy');

    // Fines de semana siempre bloqueados (oscuros)
    if (!dia.esLaborable && dia.esDelMes) clases.push('dia-celda--bloqueado');

    if (dia.esDelMes && dia.esLaborable) {
      if (this.modoEdicion()) {
        if (this.esFestivoSeleccionado(dia.fecha)) {
          clases.push('dia-celda--festivo-seleccionado');
        }
      } else {
        if (dia.esFestivo) clases.push('dia-celda--festivo');
      }
    }

    if (dia.reservas.length > 0 && !this.modoEdicion()) {
      clases.push('dia-celda--con-reservas');
    }

    return clases.join(' ');
  }

  onClickDia(dia: DiaCalendario) {
    if (this.modoEdicion() && this.esAdmin()) {
      this.toggleFestivo(dia);
    }
  }

  volver() {
    this.router.navigateByUrl('/dashboard');
  }
}
