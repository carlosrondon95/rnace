import { Injectable, signal } from '@angular/core';

export interface ConfirmationOptions {
  titulo: string;
  mensaje: string;
  textoConfirmar?: string;
  textoCancelar?: string;
  tipo?: 'danger' | 'warning' | 'info';
}

@Injectable({
  providedIn: 'root',
})
export class ConfirmationService {
  private _state = signal<{
    isOpen: boolean;
    options: ConfirmationOptions | null;
    resolve: ((value: boolean) => void) | null;
  }>({
    isOpen: false,
    options: null,
    resolve: null,
  });

  state = this._state.asReadonly();

  confirm(options: ConfirmationOptions): Promise<boolean> {
    return new Promise((resolve) => {
      this._state.set({
        isOpen: true,
        options: {
          textoConfirmar: 'Confirmar',
          textoCancelar: 'Cancelar',
          tipo: 'info',
          ...options,
        },
        resolve,
      });
    });
  }

  close(confirmed: boolean) {
    const currentState = this._state();
    if (currentState.resolve) {
      currentState.resolve(confirmed);
    }
    this._state.set({
      isOpen: false,
      options: null,
      resolve: null,
    });
  }
}
