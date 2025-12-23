import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfirmationService } from './confirmation.service';

@Component({
  standalone: true,
  selector: 'app-confirmation-modal',
  imports: [CommonModule],
  template: `
    @if (state().isOpen) {
      <div class="modal-overlay" (click)="cancel()">
        <div class="modal-content" (click)="$event.stopPropagation()" [class]="'modal-' + state().options?.tipo">
          <div class="modal-header">
            @if (state().options?.tipo === 'danger') {
              <span class="material-symbols-rounded icon-danger">warning</span>
            } @else if (state().options?.tipo === 'warning') {
              <span class="material-symbols-rounded icon-warning">info</span>
            } @else {
              <span class="material-symbols-rounded icon-info">help</span>
            }
            <h3>{{ state().options?.titulo }}</h3>
          </div>
          
          <p class="modal-body">{{ state().options?.mensaje }}</p>

          <div class="modal-actions">
            @if (state().options?.textoCancelar) {
            <button type="button" class="btn-cancel" (click)="cancel()">
              {{ state().options?.textoCancelar }}
            </button>
            }
            <button type="button" class="btn-confirm" (click)="confirm()">
              {{ state().options?.textoConfirmar }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styleUrl: './confirmation-modal.component.scss'
})
export class ConfirmationModalComponent {
  private service = inject(ConfirmationService);
  state = this.service.state;

  confirm() {
    this.service.close(true);
  }

  cancel() {
    this.service.close(false);
  }
}
