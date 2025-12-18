// src/app/components/calendario/calendario.component.ts
// ACTUALIZADO: Usa nuevas funciones del sistema de horarios fijos
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { supabase } from '../../core/supabase.client';

interface DiaCalendario {
  fecha: string;
  dia: number;
  diaSemana: number;
  esDelMes: boolean;
  esHoy: boolean;
  esLaborable: boolean;
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
  es_propia: boolean;
}

interface MesAgenda {
  anio: number;
  mes: number;
  abierto: boolean;
}

interface ReservaDB {
  id: number;
  sesion_id: number;
  usuario_id: string;
  estado: string;
  sesiones:
    | {
        fecha: string;
        hora: string;
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

interface ReservaDBLista {
  id: number;
  sesion_id: number;
  es_recuperacion: boolean;
  sesiones:
    | {
        fecha: string;
        hora: string;
        modalidad: string;
      }
    | {
        fecha: string;
        hora: string;
        modalidad: string;
      }[];
}

interface ReservaLista {
  id: number;
  sesion_id: number;
  fecha: string;
  hora: string;
  modalidad: 'focus' | 'reducido';
  dia_nombre: string;
  es_recuperacion: boolean;
  puede_cancelar: boolean;
}

@Component({
  standalone: true,
  selector: 'app-calendario',
  imports: [CommonModule],
  templateUrl: './calendario.component.html',
  styleUrls: ['./calendario.component.scss'],
})
export class CalendarioComponent implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);

  // Estado
  cargando = signal(true);
  guardando = signal(false);
  error = signal<string | null>(null);
  mensajeExito = signal<string | null>(null);

  // Fecha actual del calendario
  anioActual = signal(new Date().getFullYear());
  mesActual = signal(new Date().getMonth() + 1);

  // Datos
  diasCalendario = signal<DiaCalendario[]>([]);
  reservasLista = signal<ReservaLista[]>([]);
  mesAgenda = signal<MesAgenda | null>(null);
  festivosSeleccionados = signal<Set<string>>(new Set());

  // Usuario
  esAdmin = computed(() => this.auth.getRol() === 'admin');
  userId = computed(() => this.auth.userId());

  // Modo edición
  modoEdicion = signal(false);

  // Computed
  nombreMes = computed(() => {
    const fecha = new Date(this.anioActual(), this.mesActual() - 1, 1);
    const nombreMes = fecha.toLocaleDateString('es-ES', { month: 'long' });
    const anio = this.anioActual();
    return `${nombreMes} ${anio}`;
  });

  mesEstaAbierto = computed(() => this.mesAgenda()?.abierto ?? false);

  // Solo mostrar lunes a viernes (diaSemana 0-4)
  diasCalendarioLaborables = computed(() => {
    return this.diasCalendario().filter((dia) => dia.diaSemana >= 0 && dia.diaSemana <= 4);
  });

  // Empezamos por Lunes (Lun, Mar, Mié, Jue, Vie)
  diasSemana = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie'];

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
    if (this.esAdmin()) {
      this.cargarCalendario();
    } else {
      this.cargarReservasLista();
    }
  }

  async cargarCalendario() {
    this.cargando.set(true);
    this.error.set(null);
    this.mensajeExito.set(null);

    try {
      const anio = this.anioActual();
      const mes = this.mesActual();
      const client = supabase();

      // Cargar agenda del mes
      try {
        const { data: agendaData, error: agendaError } = await client
          .from('agenda_mes')
          .select('*')
          .eq('anio', anio)
          .eq('mes', mes)
          .maybeSingle();

        if (agendaError && agendaError.code !== 'PGRST116') {
          console.error('Error cargando agenda:', agendaError);
        }

        this.mesAgenda.set(agendaData || { anio, mes, abierto: false });
      } catch (err) {
        console.error('Error al cargar agenda del mes:', err);
        this.mesAgenda.set({ anio, mes, abierto: false });
      }

      // Calcular fechas del mes correctamente
      const primerDia = `${anio}-${mes.toString().padStart(2, '0')}-01`;
      // Último día del mes: creamos fecha del siguiente mes día 0
      const ultimoDiaMes = new Date(anio, mes, 0).getDate();
      const ultimoDia = `${anio}-${mes.toString().padStart(2, '0')}-${ultimoDiaMes.toString().padStart(2, '0')}`;

      // Cargar festivos
      const festivosSet = new Set<string>();
      try {
        const { data: festivosData, error: festivosError } = await client
          .from('festivos')
          .select('fecha')
          .gte('fecha', primerDia)
          .lte('fecha', ultimoDia);

        if (festivosError) {
          console.warn('Error cargando festivos:', festivosError);
        } else {
          (festivosData || []).forEach((f) => festivosSet.add(f.fecha));
        }
      } catch (err) {
        console.warn('Error al cargar festivos:', err);
      }

      let reservasData: ReservaDB[] = [];

      // Cargar reservas
      try {
        if (this.esAdmin()) {
          // ADMIN: cargar todas las reservas del mes
          const { data, error } = await client
            .from('reservas')
            .select(
              `
              id,
              sesion_id,
              usuario_id,
              estado,
              sesiones!inner (
                fecha,
                hora,
                modalidad
              )
            `,
            )
            .gte('sesiones.fecha', primerDia)
            .lte('sesiones.fecha', ultimoDia)
            .eq('estado', 'activa');

          if (error) {
            console.warn('Error cargando reservas:', error);
          } else {
            reservasData = (data as ReservaDB[]) || [];
          }

          // Cargar nombres de usuarios
          if (reservasData.length > 0) {
            try {
              const userIds = [...new Set(reservasData.map((r) => r.usuario_id))];
              const { data: usuariosData, error: usuariosError } = await client
                .from('usuarios')
                .select('id, nombre, telefono')
                .in('id', userIds);

              if (usuariosError) {
                console.warn('Error cargando usuarios:', usuariosError);
              } else {
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
            } catch (err) {
              console.warn('Error al cargar nombres de usuarios:', err);
            }
          }
        } else {
          // CLIENTE: solo sus propias reservas
          const uid = this.userId();
          if (uid) {
            const { data, error } = await client
              .from('reservas')
              .select(
                `
                id,
                sesion_id,
                usuario_id,
                estado,
                sesiones!inner (
                  fecha,
                  hora,
                  modalidad
                )
              `,
              )
              .eq('usuario_id', uid)
              .gte('sesiones.fecha', primerDia)
              .lte('sesiones.fecha', ultimoDia)
              .eq('estado', 'activa');

            if (error) {
              console.warn('Error cargando reservas del usuario:', error);
            } else {
              reservasData = ((data as ReservaDB[]) || []).map((r) => ({
                ...r,
                usuario_nombre: this.auth.usuario()?.nombre || 'Tú',
                usuario_telefono: this.auth.usuario()?.telefono || '',
              }));
            }
          }
        }
      } catch (err) {
        console.warn('Error al cargar reservas:', err);
      }

      const dias = this.construirDiasCalendario(anio, mes, festivosSet, reservasData);
      this.diasCalendario.set(dias);
    } catch (err) {
      console.error('Error general cargando calendario:', err);
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

    // Obtener información del mes usando Date con parámetros numéricos (evita problemas de zona horaria)
    const primerDiaDelMes = new Date(anio, mes - 1, 1);
    const ultimoDiaMes = new Date(anio, mes, 0).getDate(); // Último día del mes

    // getDay() devuelve 0=Dom, 1=Lun, etc. Convertimos a 0=Lun, 1=Mar, etc.
    let primerDiaSemana = primerDiaDelMes.getDay();
    // Convertir: Dom(0)->6, Lun(1)->0, Mar(2)->1, etc.
    primerDiaSemana = primerDiaSemana === 0 ? 6 : primerDiaSemana - 1;

    // Fecha de hoy para comparar
    const hoyDate = new Date();
    const hoy = `${hoyDate.getFullYear()}-${(hoyDate.getMonth() + 1).toString().padStart(2, '0')}-${hoyDate.getDate().toString().padStart(2, '0')}`;

    const mesAbierto = this.mesAgenda()?.abierto ?? false;
    const userId = this.userId();

    // Mapa de reservas por fecha
    const reservasPorFecha = new Map<string, ReservaCalendario[]>();
    reservasData.forEach((r) => {
      if (!r.sesiones || r.sesiones.length === 0) return;

      const sesion = r.sesiones[0];
      const fecha = sesion.fecha;
      const hora = sesion.hora.substring(0, 5);

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

    // Días del mes anterior para completar primera semana
    if (primerDiaSemana > 0) {
      const mesAnterior = mes === 1 ? 12 : mes - 1;
      const anioAnterior = mes === 1 ? anio - 1 : anio;
      const ultimoDiaMesAnterior = new Date(anio, mes - 1, 0).getDate();

      for (let i = primerDiaSemana - 1; i >= 0; i--) {
        const dia = ultimoDiaMesAnterior - i;
        const fecha = `${anioAnterior}-${mesAnterior.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;

        // Calcular día de la semana usando Date con parámetros numéricos
        const fechaObj = new Date(anioAnterior, mesAnterior - 1, dia);
        let diaSemana = fechaObj.getDay();
        diaSemana = diaSemana === 0 ? 6 : diaSemana - 1; // Convertir a formato Lun=0

        dias.push({
          fecha,
          dia,
          diaSemana,
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
    for (let dia = 1; dia <= ultimoDiaMes; dia++) {
      const fecha = `${anio}-${mes.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;

      // Usar Date con parámetros numéricos para evitar problemas de zona horaria
      const fechaObj = new Date(anio, mes - 1, dia);
      let diaSemana = fechaObj.getDay();
      // Convertir: Dom(0)->6, Lun(1)->0, Mar(2)->1, etc.
      diaSemana = diaSemana === 0 ? 6 : diaSemana - 1;

      // Laborable: Lun(0) a Vie(4)
      const esLaborable = diaSemana >= 0 && diaSemana <= 4;
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

    // Días del mes siguiente para completar última semana
    const totalDias = dias.length;
    const diasFaltantes = totalDias % 7 === 0 ? 0 : 7 - (totalDias % 7);

    if (diasFaltantes > 0) {
      const mesSiguiente = mes === 12 ? 1 : mes + 1;
      const anioSiguiente = mes === 12 ? anio + 1 : anio;

      for (let dia = 1; dia <= diasFaltantes; dia++) {
        const fecha = `${anioSiguiente}-${mesSiguiente.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;

        const fechaObj = new Date(anioSiguiente, mesSiguiente - 1, dia);
        let diaSemana = fechaObj.getDay();
        diaSemana = diaSemana === 0 ? 6 : diaSemana - 1;

        dias.push({
          fecha,
          dia,
          diaSemana,
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

  activarModoEdicion() {
    if (!this.esAdmin()) return;

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
      const ultimoDiaMes = new Date(anio, mes, 0).getDate();
      const ultimoDia = `${anio}-${mes.toString().padStart(2, '0')}-${ultimoDiaMes.toString().padStart(2, '0')}`;

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

      const { data: existente } = await client
        .from('agenda_mes')
        .select('anio, mes')
        .eq('anio', anio)
        .eq('mes', mes)
        .maybeSingle();

      if (existente) {
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
        const { error: insertError } = await client
          .from('agenda_mes')
          .insert({ anio, mes, abierto: true });

        if (insertError) {
          console.error('Error insertando agenda_mes:', insertError);
          this.error.set(`Error al abrir el mes: ${insertError.message}`);
          return;
        }
      }

      // Generar sesiones del mes
      const { error: genError } = await client.rpc('generar_sesiones_mes', {
        p_anio: anio,
        p_mes: mes,
      });

      if (genError) {
        console.warn('No se pudieron generar sesiones automáticamente:', genError);
      }

      this.mensajeExito.set('Mes configurado correctamente. Los usuarios ya pueden reservar.');
      this.modoEdicion.set(false);
      this.festivosSeleccionados.set(new Set());

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

  getDiaClases(dia: DiaCalendario): string {
    const clases = ['dia-celda'];

    if (!dia.esDelMes) clases.push('dia-celda--otro-mes');
    if (dia.esHoy) clases.push('dia-celda--hoy');

    // Fin de semana (Sáb=5, Dom=6) o festivo = bloqueado
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

  async cargarReservasLista() {
    const uid = this.userId();
    if (!uid) return;

    this.cargando.set(true);
    this.error.set(null);

    try {
      const client = supabase();
      const hoy = new Date().toISOString().split('T')[0];

      // Cargar reservas futuras del usuario
      const { data, error } = await client
        .from('reservas')
        .select(
          `
          id,
          sesion_id,
          es_recuperacion,
          sesiones!inner (
            fecha,
            hora,
            modalidad
          )
        `,
        )
        .eq('usuario_id', uid)
        .eq('estado', 'activa')
        .gte('sesiones.fecha', hoy)
        .order('sesiones(fecha)', { ascending: true });

      if (error) {
        console.error('Error cargando reservas:', error);
        this.error.set('Error al cargar tus reservas.');
        this.reservasLista.set([]);
        return;
      }

      const reservas: ReservaLista[] = (data || []).map((r: ReservaDBLista) => {
        const sesion = Array.isArray(r.sesiones) ? r.sesiones[0] : r.sesiones;
        const fechaObj = new Date(sesion.fecha + 'T' + sesion.hora);
        const ahora = new Date();
        const horasHastaClase = (fechaObj.getTime() - ahora.getTime()) / (1000 * 60 * 60);

        return {
          id: r.id,
          sesion_id: r.sesion_id,
          fecha: fechaObj.toLocaleDateString('es-ES', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          }),
          hora: sesion.hora.substring(0, 5),
          modalidad: sesion.modalidad as 'focus' | 'reducido',
          dia_nombre: fechaObj.toLocaleDateString('es-ES', { weekday: 'long' }),
          es_recuperacion: r.es_recuperacion || false,
          puede_cancelar: horasHastaClase >= 1,
        };
      });

      this.reservasLista.set(reservas);
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error al cargar tus reservas.');
    } finally {
      this.cargando.set(false);
    }
  }

  async cancelarReserva(reservaId: number) {
    if (!confirm('¿Estás seguro de cancelar esta reserva?')) {
      return;
    }

    this.guardando.set(true);
    this.error.set(null);
    this.mensajeExito.set(null);

    try {
      const uid = this.userId();
      if (!uid) return;

      const { data, error } = await supabase().rpc('cancelar_reserva', {
        p_usuario_id: uid,
        p_reserva_id: reservaId,
      });

      if (error) {
        this.error.set('Error al cancelar la reserva: ' + error.message);
        return;
      }

      if (data && data.length > 0) {
        const resultado = data[0];
        if (resultado.ok) {
          this.mensajeExito.set(resultado.mensaje);
          await this.cargarReservasLista();
        } else {
          this.error.set(resultado.mensaje);
        }
      }
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error al cancelar la reserva.');
    } finally {
      this.guardando.set(false);
    }
  }

  volver() {
    this.router.navigateByUrl('/dashboard');
  }
}
