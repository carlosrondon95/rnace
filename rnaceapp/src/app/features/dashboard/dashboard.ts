import { Component, inject, signal } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { supabase } from '../../core/supabase.client';
import { AuthService } from '../../core/auth.service';

interface Elemento {
  id: number;
  titulo: string;
}

@Component({
  standalone: true,
  selector: 'app-dashboard',
  imports: [NgFor, NgIf, FormsModule],
  template: `
  <section class="max-w-2xl mx-auto p-6 space-y-4">
    <div class="flex items-center justify-between">
      <h2 class="text-2xl font-semibold">Tus elementos</h2>
      <button class="text-sm underline" (click)="salir()">Salir</button>
    </div>

    <div class="flex gap-2">
      <input class="flex-1 border rounded-lg p-2" placeholder="Nuevo título" [(ngModel)]="titulo">
      <button class="px-4 rounded-lg bg-brand-500 text-white" (click)="agregar()">Añadir</button>
    </div>

    <ul class="divide-y rounded-lg border">
      <li *ngFor="let it of elementos()" class="p-3">{{ it.titulo }}</li>
    </ul>

    <p *ngIf="elementos().length === 0" class="text-gray-500 text-sm">Aún no tienes elementos.</p>
  </section>
  `
})
export class Dashboard {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  elementos = signal<Elemento[]>([]);
  titulo = '';

  constructor() { this.cargar(); }

  async cargar() {
    const { data, error } = await supabase()
      .from('elementos')
      .select('id, titulo')
      .order('id', { ascending: false });

    if (!error && data) this.elementos.set(data as Elemento[]);
  }

  async agregar() {
    const uid = this.auth.userId();
    const t = this.titulo.trim();
    if (!uid || !t) return;

    const { data, error } = await supabase()
      .from('elementos')
      .insert({ usuario_id: uid, titulo: t })
      .select('id, titulo')
      .single();

    if (!error && data) {
      this.elementos.update(arr => [data as Elemento, ...arr]);
      this.titulo = '';
    }
  }

  async salir() {
    await this.auth.signOut();
    this.router.navigateByUrl('/login');
  }
}
