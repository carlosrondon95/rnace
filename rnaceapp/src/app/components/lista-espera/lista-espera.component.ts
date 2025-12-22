// src/app/components/lista-espera/lista-espera.component.ts
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ConfirmationService } from '../../shared/confirmation-modal/confirmation.service';
import { supabase } from '../../core/supabase.client';

interface SesionAgrupada {
  sesion_id: number;
  fecha: string;
  hora: string;
  modalidad: string;
  capacidad: number;
  plazas_ocupadas: number;
  plazas_disponibles: number;
  usuarios: {
    usuario_id: string;
    nombre: string;
    telefono: string;
    posicion: number;
    creado_en: string;
  }[];
}

@Component({
  standalone: true,
  selector: 'app-lista-espera',
  imports: [CommonModule],
  templateUrl: './lista-espera.component.html',
  styleUrls: ['./lista-espera.component.scss'],
})
export class ListaEsperaComponent implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);
  private confirmation = inject(ConfirmationService);

  // Estado
  cargando = signal(true);
  procesando = signal(false);
  error = signal<string | null>(null);
  mensajeExito = signal<string | null>(null);

  // Datos
  sesionesAgrupadas = signal<SesionAgrupada[]>([]);

  // Computed
  esAdmin = computed(() => this.auth.getRol() === 'admin');
  totalEnEspera = computed(() =>
    this.sesionesAgrupadas().reduce((sum, s) => sum + s.usuarios.length, 0),
  );

  ngOnInit() {
    if (!this.esAdmin()) {
      this.router.navigateByUrl('/dashboard');
      return;
    }
    this.cargarListaEspera();
  }

  async cargarListaEspera() {
    this.cargando.set(true);
    this.error.set(null);

    try {
      const hoy = new Date().toISOString().split('T')[0];

      // Cargar lista de espera con sesiones futuras
      const { data: listaData, error: listaError } = await supabase()
        .from('lista_espera')
        .select(
          `
          sesion_id,
          usuario_id,
          creado_en,
          sesiones!inner (
            id,
            fecha,
            hora,
            modalidad,
            capacidad,
            cancelada
          )
        `,
        )
        .gte('sesiones.fecha', hoy)
        .eq('sesiones.cancelada', false)
        .order('creado_en', { ascending: true });

      if (listaError) {
        console.error('Error cargando lista:', listaError);
        this.error.set('Error al cargar la lista de espera');
        return;
      }

      if (!listaData || listaData.length === 0) {
        this.sesionesAgrupadas.set([]);
        return;
      }

      // Obtener IDs de usuarios y sesiones
      const userIds = [...new Set(listaData.map((item) => item.usuario_id))];
      const sesionIds = [...new Set(listaData.map((item) => item.sesion_id))];

      // Cargar nombres de usuarios
      const { data: usuariosData } = await supabase()
        .from('usuarios')
        .select('id, nombre, telefono')
        .in('id', userIds);

      const usuariosMap = new Map<string, { nombre: string; telefono: string }>();
      (usuariosData || []).forEach((u) => {
        usuariosMap.set(u.id, { nombre: u.nombre || 'Sin nombre', telefono: u.telefono });
      });

      // Contar reservas por sesión
      const { data: reservasData } = await supabase()
        .from('reservas')
        .select('sesion_id')
        .in('sesion_id', sesionIds)
        .eq('estado', 'activa');

      const reservasPorSesion = new Map<number, number>();
      (reservasData || []).forEach((r) => {
        const count = reservasPorSesion.get(r.sesion_id) || 0;
        reservasPorSesion.set(r.sesion_id, count + 1);
      });

      // Agrupar por sesión
      const sesionesMap = new Map<number, SesionAgrupada>();

      listaData.forEach((item) => {
        const sesionData = item.sesiones as unknown;
        const sesion = (Array.isArray(sesionData) ? sesionData[0] : sesionData) as {
          id: number;
          fecha: string;
          hora: string;
          modalidad: string;
          capacidad: number;
        };
        if (!sesion) return;

        const fechaObj = new Date(sesion.fecha + 'T' + sesion.hora);
        const plazasOcupadas = reservasPorSesion.get(item.sesion_id) || 0;

        if (!sesionesMap.has(item.sesion_id)) {
          sesionesMap.set(item.sesion_id, {
            sesion_id: item.sesion_id,
            fecha: fechaObj.toLocaleDateString('es-ES', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            }),
            hora: sesion.hora.substring(0, 5),
            modalidad: sesion.modalidad,
            capacidad: sesion.capacidad,
            plazas_ocupadas: plazasOcupadas,
            plazas_disponibles: sesion.capacidad - plazasOcupadas,
            usuarios: [],
          });
        }

        const sesionAgrupada = sesionesMap.get(item.sesion_id);
        if (sesionAgrupada) {
          const usuario = usuariosMap.get(item.usuario_id);
          sesionAgrupada.usuarios.push({
            usuario_id: item.usuario_id,
            nombre: usuario?.nombre || 'Sin nombre',
            telefono: usuario?.telefono || '',
            posicion: sesionAgrupada.usuarios.length + 1,
            creado_en: new Date(item.creado_en).toLocaleDateString('es-ES', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            }),
          });
        }
      });

      // Ordenar por fecha de sesión
      const sesionesOrdenadas = [...sesionesMap.values()].sort((a, b) => {
        return a.sesion_id - b.sesion_id;
      });

      this.sesionesAgrupadas.set(sesionesOrdenadas);
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error inesperado');
    } finally {
      this.cargando.set(false);
    }
  }

  async asignarPlaza(sesion: SesionAgrupada, usuarioId: string) {
    if (sesion.plazas_disponibles <= 0) {
      this.error.set('No hay plazas disponibles en esta sesión');
      return;
    }

    if (!await this.confirmation.confirm({
      titulo: 'Asignar plaza',
      mensaje: '¿Asignar plaza a este usuario? Se creará una reserva y se le notificará.',
      textoConfirmar: 'Asignar',
      tipo: 'info'
    })) {
      return;
    }

    this.procesando.set(true);
    this.error.set(null);
    this.mensajeExito.set(null);

    try {
      // Verificar si el usuario tiene recuperación disponible
      const { data: recuperaciones } = await supabase().rpc('obtener_recuperaciones_usuario', {
        p_usuario_id: usuarioId,
      });

      const tieneRecuperacion = (recuperaciones || []).some(
        (r: { modalidad: string }) => r.modalidad === sesion.modalidad,
      );

      if (!tieneRecuperacion) {
        this.error.set('El usuario no tiene recuperaciones disponibles para esta modalidad');
        return;
      }

      // Usar la recuperación
      const { data, error } = await supabase().rpc('usar_recuperacion', {
        p_usuario_id: usuarioId,
        p_sesion_id: sesion.sesion_id,
      });

      if (error) {
        console.error('Error asignando plaza:', error);
        this.error.set('Error al asignar la plaza: ' + error.message);
        return;
      }

      const resultado = data?.[0];
      if (resultado && !resultado.ok) {
        this.error.set(resultado.mensaje);
        return;
      }

      // Crear notificación
      await supabase()
        .from('notificaciones')
        .insert({
          usuario_id: usuarioId,
          tipo: 'plaza_asignada',
          titulo: '¡Plaza asignada!',
          mensaje: `Se te ha asignado plaza en la clase de ${sesion.modalidad} del ${sesion.fecha} a las ${sesion.hora}`,
          sesion_id: sesion.sesion_id,
          accion_url: '/calendario',
        });

      this.mensajeExito.set('Plaza asignada correctamente');
      await this.cargarListaEspera();
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error inesperado');
    } finally {
      this.procesando.set(false);
    }
  }

  async quitarDeEspera(sesionId: number, usuarioId: string) {
    if (!await this.confirmation.confirm({
      titulo: 'Quitar de lista de espera',
      mensaje: '¿Quitar a este usuario de la lista de espera?',
      tipo: 'warning',
      textoConfirmar: 'Quitar'
    })) {
      return;
    }

    this.procesando.set(true);
    this.error.set(null);

    try {
      const { error } = await supabase()
        .from('lista_espera')
        .delete()
        .eq('sesion_id', sesionId)
        .eq('usuario_id', usuarioId);

      if (error) {
        this.error.set('Error al quitar de la lista');
        return;
      }

      this.mensajeExito.set('Usuario eliminado de la lista de espera');
      await this.cargarListaEspera();
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error inesperado');
    } finally {
      this.procesando.set(false);
    }
  }

  async notificarUsuario(sesion: SesionAgrupada, usuarioId: string, nombre: string) {
    this.procesando.set(true);

    try {
      await supabase()
        .from('notificaciones')
        .insert({
          usuario_id: usuarioId,
          tipo: 'hueco_disponible',
          titulo: '¡Hay una plaza disponible!',
          mensaje: `Hay plaza en la clase de ${sesion.modalidad} del ${sesion.fecha} a las ${sesion.hora}. ¡Date prisa!`,
          sesion_id: sesion.sesion_id,
          accion_url: `/calendario?sesion=${sesion.sesion_id}`,
        });

      this.mensajeExito.set(`Notificación enviada a ${nombre}`);
      setTimeout(() => this.mensajeExito.set(null), 3000);
    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error al enviar notificación');
    } finally {
      this.procesando.set(false);
    }
  }

  volver() {
    this.router.navigateByUrl('/dashboard');
  }

  trackBySesionId(_index: number, sesion: SesionAgrupada): number {
    return sesion.sesion_id;
  }

  trackByUsuarioId(_index: number, usuario: { usuario_id: string }): string {
    return usuario.usuario_id;
  }
}
