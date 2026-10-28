import { PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { NavigationError } from '@angular/router';
import { ConfirmationService } from '../shared/confirmation-modal/confirmation.service';

// Tras un deploy, una app abierta con el build anterior pide chunk-<hash>.js que ya no
// existen (Netlify responde 302 → /dashboard, HTML) y el import() del loadComponent falla:
// el router se queda donde estaba sin avisar. Se recarga el documento en la URL pedida,
// que ya trae el build nuevo. Sin red, o si ya se recargó hace < 60 s, se explica con un aviso.
const CLAVE_RECARGA = 'rnace_recarga_chunk';
const VENTANA_ANTIBUCLE_MS = 60_000;
const FALLOS_DE_CHUNK = [
  'failed to fetch dynamically imported module', // Chrome, Edge, Android
  'error loading dynamically imported module',   // Firefox
  'importing a module script failed',            // Safari
  'is not a valid javascript mime type',         // Safari al recibir HTML en vez de JS
];

export function esFalloDeChunk(error: unknown): boolean {
  const texto = String((error as { message?: unknown } | null)?.message ?? error ?? '').toLowerCase();
  return FALLOS_DE_CHUNK.some((m) => texto.includes(m));
}

// true si este documento nació de una recarga por chunk hace < 60 s (o si no hay sessionStorage)
function recargaReciente(): boolean {
  try {
    const ts = Number(sessionStorage.getItem(CLAVE_RECARGA));
    if (!ts || Date.now() - ts >= VENTANA_ANTIBUCLE_MS) return false;
    // Un documento ANTERIOR a esa recarga (p. ej. restaurado del bfcache) sí puede recargar
    return !(performance.timeOrigin < ts - 1_000);
  } catch {
    return true;
  }
}

// La red responde de verdad (navigator.onLine puede decir true sin conexión)
async function hayConexion(): Promise<boolean> {
  if (navigator.onLine === false) return false;
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), 5_000);
  try {
    const respuesta = await fetch('/manifest.webmanifest', { cache: 'no-store', signal: control.signal });
    return respuesta.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(temporizador);
  }
}

export function recuperarFalloDeChunk(evento: NavigationError): void {
  try {
    if (!isPlatformBrowser(inject(PLATFORM_ID)) || !esFalloDeChunk(evento.error)) return; // resto de errores: igual que hoy
    const confirmation = inject(ConfirmationService); // inject() solo funciona aquí, antes de cualquier await
    void (async () => {
      const conexion = await hayConexion();
      if (conexion && !recargaReciente()) {
        try {
          sessionStorage.setItem(CLAVE_RECARGA, String(Date.now()));
          console.warn('[Navegación] Versión anterior de la app: recargando en', evento.url, evento.error);
          window.location.assign(evento.url); // no reload(): la barra aún muestra la pantalla de origen
          return;
        } catch {
          /* sin sessionStorage no hay anti-bucle: no recargar */
        }
      }
      console.warn('[Navegación] No se pudo cargar la pantalla', evento.url, evento.error);
      void confirmation.confirm({
        titulo: 'No se ha podido abrir la pantalla',
        mensaje: conexion
          ? 'Cierra la app y vuelve a abrirla para cargar la última versión. Si sigue sin abrirse, revisa tu conexión.'
          : 'Parece que no tienes conexión. Vuelve a intentarlo cuando la recuperes.',
        tipo: 'warning',
        textoConfirmar: 'Entendido',
        textoCancelar: '',
      });
    })();
  } catch (err) {
    console.warn('[Navegación] Error en el manejador de navegación', err);
  }
  // Nunca devolver RedirectCommand: repetiría el mismo import() fallido en este documento.
}
