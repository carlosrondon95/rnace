import { Injectable, signal } from '@angular/core';
import { Session } from '@supabase/supabase-js';
import { supabase } from './supabase.client';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private _session = signal<Session | null>(null);
  session = this._session.asReadonly();

  constructor() {
    // Cargar sesión inicial
    supabase().auth.getSession().then(({ data }) => this._session.set(data.session));
    // Suscribirse a cambios
    supabase().auth.onAuthStateChange((_event, session) => this._session.set(session));
  }

  async signInWithPassword(email: string, password: string) {
    const { error } = await supabase().auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async signUp(email: string, password: string) {
    const { error } = await supabase().auth.signUp({ email, password });
    if (error) throw error;
  }

  async signOut() {
    await supabase().auth.signOut();
  }

  userId(): string | null {
    return this._session()?.user?.id ?? null;
  }

  isLoggedIn(): boolean {
    return !!this._session()?.user;
  }
}
