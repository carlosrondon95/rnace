import { Component, signal } from '@angular/core';

@Component({
  standalone: true,
  selector: 'app-settings',
  template: `
    <section class="space-y-4 max-w-xl">
      <h2 class="text-2xl font-semibold">Ajustes</h2>

      <label class="block">
        <span class="block text-sm mb-1">Modo compacto</span>
        <input type="checkbox" [checked]="compact()" (change)="toggle()" />
      </label>

      <p class="text-sm text-gray-600">(Ejemplo con <code>signals</code> para estado local.)</p>
    </section>
  `,
})
export class Settings {
  compact = signal(false);
  toggle() {
    this.compact.update((v) => !v);
  }
}
