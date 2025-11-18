// src/app/reservas/reserva-cita.component.ts
import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

type Modalidad = 'focus' | 'reducido';

interface DaySchedule {
  key: string;   // 'LUN', 'MAR'...
  label: string; // 'Lunes', ...
  slots: string[]; // horas tipo '08:00'
}

const FOCUS_SCHEDULE: DaySchedule[] = [
  { key: 'LUN', label: 'Lunes', slots: ['08:00', '09:00', '10:00', '16:00', '17:00', '18:00', '20:00'] },
  { key: 'MAR', label: 'Martes', slots: ['11:00', '18:00'] },
  { key: 'MIE', label: 'Miércoles', slots: ['08:00', '09:00', '10:00', '16:00'] },
  { key: 'JUE', label: 'Jueves', slots: ['11:00', '18:00'] },
  { key: 'VIE', label: 'Viernes', slots: ['08:00', '09:00', '10:00'] },
];

const REDUCIDO_SCHEDULE: DaySchedule[] = [
  { key: 'LUN', label: 'Lunes', slots: ['19:00'] },
  { key: 'MAR', label: 'Martes', slots: ['08:00', '09:00', '16:00', '17:00', '19:00', '20:00'] },
  { key: 'MIE', label: 'Miércoles', slots: ['17:00', '19:00', '20:00'] },
  { key: 'JUE', label: 'Jueves', slots: ['08:00', '09:00', '16:00', '17:00', '19:00', '20:00'] },
  { key: 'VIE', label: 'Viernes', slots: ['16:00'] },
];

@Component({
  standalone: true,
  selector: 'app-reserva-cita',
  imports: [CommonModule],
  templateUrl: './reserva-cita.component.html',
  styleUrls: ['./reserva-cita.component.scss'],
})
export class ReservaCitaComponent {
  modalidad: Modalidad = 'focus';

  private focusSchedule = FOCUS_SCHEDULE;
  private reducidoSchedule = REDUCIDO_SCHEDULE;

  selectedDayKey: string | null = null;
  selectedTime: string | null = null;

  get currentSchedule(): DaySchedule[] {
    return this.modalidad === 'focus'
      ? this.focusSchedule
      : this.reducidoSchedule;
  }

  get hasSelection(): boolean {
    return !!this.selectedDayKey && !!this.selectedTime;
  }

  get selectedLabel(): string | null {
    if (!this.hasSelection) return null;
    const day = this.currentSchedule.find((d) => d.key === this.selectedDayKey);
    if (!day) return null;
    return `${day.label} a las ${this.selectedTime}h`;
  }

  selectModalidad(mode: Modalidad) {
    if (this.modalidad === mode) return;
    this.modalidad = mode;
    // reset selección al cambiar de grupo
    this.selectedDayKey = null;
    this.selectedTime = null;
  }

  selectSlot(day: DaySchedule, hour: string) {
    this.selectedDayKey = day.key;
    this.selectedTime = hour;
  }

  isSelected(day: DaySchedule, hour: string): boolean {
    return this.selectedDayKey === day.key && this.selectedTime === hour;
  }

  onConfirmar() {
    if (!this.hasSelection) return;

    // De momento solo mostramos por consola; aquí luego conectaremos con la API
    console.log('Cita seleccionada (UI):', {
      modalidad: this.modalidad,
      dia: this.selectedDayKey,
      hora: this.selectedTime,
    });

    // Más adelante aquí llamaremos a Supabase para reservar
  }
}
