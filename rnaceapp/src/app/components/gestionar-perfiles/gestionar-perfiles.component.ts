// src/app/components/gestionar-perfiles/gestionar-perfiles.component.ts
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal, computed, HostListener } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { supabase } from '../../core/supabase.client';

interface PerfilPlan {
  tipo_grupo: string;
  clases_focus_semana: number;
  clases_reducido_semana: number;
  tipo_cuota: string;
  activo: boolean;
}

interface Perfil {
  id: string;
  nombre: string;
  telefono: string;
  rol: string;
  creado_en: string;
  plan?: PerfilPlan;
}

interface PerfilDB {
  id: string;
  nombre: string | null;
  telefono: string | null;
  rol: string;
  creado_en: string;
  plan_usuario: PerfilPlan[] | null;
}

interface NuevoUsuario {
  nombre: string;
  apellidos: string;
  telefono: string;
  tipoGrupo: 'focus' | 'reducido' | 'hibrido' | 'especial';
  clasesFocus: number;
  clasesReducido: number;
  tipoCuota: 'semanal' | 'mensual';
  password: string;
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

  // Estado
  cargando = signal(true);
  error = signal<string | null>(null);
  perfiles = signal<Perfil[]>([]);
  busqueda = signal('');
  
  // Modal nuevo usuario
  mostrarModal = signal(false);
  guardando = signal(false);
  errorModal = signal<string | null>(null);
  exitoModal = signal<string | null>(null);
  passwordCopiada = signal(false);

  // Formulario nuevo usuario
  nuevoUsuario = signal<NuevoUsuario>({
    nombre: '',
    apellidos: '',
    telefono: '',
    tipoGrupo: 'focus',
    clasesFocus: 2,
    clasesReducido: 0,
    tipoCuota: 'semanal',
    password: '',
  });

  // Perfiles filtrados por búsqueda
  perfilesFiltrados = computed(() => {
    const busq = this.busqueda().toLowerCase().trim();
    const lista = this.perfiles();
    
    if (!busq) return lista;
    
    return lista.filter(p => 
      p.nombre?.toLowerCase().includes(busq) ||
      p.telefono?.includes(busq) ||
      p.rol?.toLowerCase().includes(busq)
    );
  });

  // Opciones para el formulario
  tiposGrupo = [
    { value: 'focus', label: 'Focus (máx 3 personas)' },
    { value: 'reducido', label: 'Reducido (máx 8 personas)' },
    { value: 'hibrido', label: 'Híbrido (Focus + Reducido)' },
    { value: 'especial', label: 'Especial (cuota personalizada)' },
  ];

  clasesOptions = [0, 1, 2, 3, 4, 5, 6, 7];

  // Cerrar modal con Escape
  @HostListener('document:keydown.escape')
  onEscapeKey() {
    if (this.mostrarModal()) {
      this.cerrarModal();
    }
  }

  ngOnInit() {
    this.cargarPerfiles();
  }

  private async cargarPerfiles() {
    this.cargando.set(true);
    this.error.set(null);

    try {
      const client = supabase();

      // Query 1: Cargar perfiles
      const { data: perfilesData, error: perfilesError } = await client
        .from('perfiles')
        .select('id, nombre, telefono, rol, creado_en')
        .order('creado_en', { ascending: false });

      if (perfilesError) {
        console.error('Error cargando perfiles:', perfilesError);
        this.error.set('Error al cargar los perfiles.');
        return;
      }

      // Query 2: Cargar todos los planes
      const { data: planesData, error: planesError } = await client
        .from('plan_usuario')
        .select('usuario_id, tipo_grupo, clases_focus_semana, clases_reducido_semana, tipo_cuota, activo');

      if (planesError) {
        console.error('Error cargando planes:', planesError);
        // No es crítico, seguimos sin planes
      }

      // Crear mapa de planes por usuario_id
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

      // Combinar perfiles con sus planes
      const perfiles: Perfil[] = (perfilesData || []).map((p) => ({
        id: p.id,
        nombre: p.nombre || '',
        telefono: p.telefono || '',
        rol: p.rol,
        creado_en: p.creado_en,
        plan: planesMap.get(p.id),
      }));

      this.perfiles.set(perfiles);

    } catch (err) {
      console.error('Error:', err);
      this.error.set('Error inesperado al cargar perfiles.');
    } finally {
      this.cargando.set(false);
    }
  }

  // Abrir modal de nuevo usuario
  abrirModalNuevo() {
    this.nuevoUsuario.set({
      nombre: '',
      apellidos: '',
      telefono: '',
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

  cerrarModal() {
    this.mostrarModal.set(false);
  }

  // Generar contraseña aleatoria
  generarPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < 8; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    this.nuevoUsuario.update(u => ({ ...u, password }));
    this.passwordCopiada.set(false);
  }

  // Copiar contraseña al portapapeles
  async copiarPassword() {
    const pass = this.nuevoUsuario().password;
    if (!pass) return;

    try {
      await navigator.clipboard.writeText(pass);
      this.passwordCopiada.set(true);
      
      // Reset después de 2 segundos
      setTimeout(() => this.passwordCopiada.set(false), 2000);
    } catch (err) {
      console.error('Error copiando:', err);
    }
  }

  // Actualizar campo del formulario
  actualizarCampo(campo: keyof NuevoUsuario, valor: string | number) {
    this.nuevoUsuario.update(u => ({ ...u, [campo]: valor }));
    
    // Ajustar clases según tipo de grupo
    if (campo === 'tipoGrupo') {
      const tipo = valor as NuevoUsuario['tipoGrupo'];
      if (tipo === 'focus') {
        this.nuevoUsuario.update(u => ({ ...u, clasesFocus: 2, clasesReducido: 0 }));
      } else if (tipo === 'reducido') {
        this.nuevoUsuario.update(u => ({ ...u, clasesFocus: 0, clasesReducido: 2 }));
      } else if (tipo === 'hibrido') {
        this.nuevoUsuario.update(u => ({ ...u, clasesFocus: 1, clasesReducido: 1 }));
      }
    }
  }

  // Validar formulario
  formularioValido(): boolean {
    const u = this.nuevoUsuario();
    return !!(
      u.nombre.trim() &&
      u.telefono.trim() &&
      u.telefono.length >= 9 &&
      u.password.length >= 6 &&
      (u.clasesFocus > 0 || u.clasesReducido > 0)
    );
  }

  // Guardar nuevo usuario
  async guardarUsuario() {
    if (!this.formularioValido()) {
      this.errorModal.set('Por favor, completa todos los campos correctamente.');
      return;
    }

    this.guardando.set(true);
    this.errorModal.set(null);
    this.exitoModal.set(null);

    const u = this.nuevoUsuario();
    const nombreCompleto = u.apellidos ? `${u.nombre} ${u.apellidos}` : u.nombre;
    const telefonoLimpio = u.telefono.replace(/[^0-9]/g, '');
    const emailFalso = `${telefonoLimpio}@rnace.local`;

    try {
      const client = supabase();

      // Llamar a la Edge Function para crear el usuario
      const { data, error } = await client.functions.invoke('crear-usuario', {
        body: {
          email: emailFalso,
          password: u.password,
          nombre: nombreCompleto,
          telefono: telefonoLimpio,
          rol: 'cliente',
          tipoGrupo: u.tipoGrupo,
          clasesFocus: u.clasesFocus,
          clasesReducido: u.clasesReducido,
          tipoCuota: u.tipoCuota,
        },
      });

      if (error) {
        console.error('Error creando usuario:', error);
        // Intentar obtener más detalles del error
        let mensajeError = 'Error al crear el usuario.';
        if (error.message) {
          mensajeError = error.message;
        }
        // Si el error tiene context con body, extraerlo
        const errorAny = error as { context?: { body?: string } };
        if (errorAny.context?.body) {
          try {
            const body = JSON.parse(errorAny.context.body);
            if (body.error) {
              mensajeError = body.error;
            }
          } catch {
            // Ignorar error de parsing
          }
        }
        this.errorModal.set(mensajeError);
        return;
      }

      const resultado = data as { error?: string; success?: boolean };

      if (resultado?.error) {
        this.errorModal.set(resultado.error);
        return;
      }

      this.exitoModal.set(`Usuario creado correctamente. Teléfono: ${telefonoLimpio}`);
      
      // Recargar lista
      await this.cargarPerfiles();

    } catch (err) {
      console.error('Error:', err);
      this.errorModal.set('Error inesperado al crear el usuario.');
    } finally {
      this.guardando.set(false);
    }
  }

  // Formatear fecha
  formatearFecha(fecha: string): string {
    if (!fecha) return '-';
    return new Date(fecha).toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  // Obtener etiqueta del grupo
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

  // Obtener clase CSS para el rol
  obtenerClaseRol(rol: string): string {
    if (rol === 'admin') return 'rol-admin';
    if (rol === 'profesor') return 'rol-profesor';
    return 'rol-cliente';
  }

  volver() {
    this.router.navigateByUrl('/dashboard');
  }
}