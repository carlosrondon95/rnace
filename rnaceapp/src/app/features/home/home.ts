import { Component } from '@angular/core';

@Component({
  standalone: true,
  selector: 'app-home',
  template: `
    <section class="space-y-4">
      <h2 class="text-2xl font-semibold">Bienvenido</h2>
      <p class="text-gray-700">Base lista con Angular + SSR + Tailwind.</p>

      <div class="rounded-xl p-5 border">
        <h3 class="text-lg font-medium mb-2">Estado del proyecto</h3>
        <ul class="list-disc pl-5">
          <li>Angular 20 estable</li>
          <li>SSR e hidratación activas</li>
          <li class="text-brand-500">Color primario #00BCD4 aplicado</li>
          <li>Fuente Poppins cargada</li>
        </ul>
      </div>

      <a
        routerLink="/settings"
        class="inline-flex items-center gap-2 px-4 py-2 rounded-lg border hover:opacity-90"
      >
        Ir a Ajustes
      </a>
    </section>
  `,
  styles: [
    `
      /* ejemplo de uso del color de marca via token */
      .text-brand-500 {
        color: var(--color-brand-500);
      }
      a {
        transition: opacity 0.15s ease;
      }
    `,
  ],
})
export class Home {}
