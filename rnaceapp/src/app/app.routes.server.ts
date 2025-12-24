import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: 'login',
    renderMode: RenderMode.Client, // Login usa servicios del browser
  },
  {
    path: 'dashboard',
    renderMode: RenderMode.Client, // Dashboard usa servicios del browser
  },
  {
    path: '**',
    renderMode: RenderMode.Client, // Usar CSR por defecto para evitar errores de Worker
  },
];
