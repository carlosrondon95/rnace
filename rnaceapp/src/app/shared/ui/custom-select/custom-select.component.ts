import { Component, Input, Output, EventEmitter, Signal, signal, ElementRef, HostListener, ViewChild, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface SelectOption {
    value: any;
    label: string;
}

@Component({
    selector: 'app-custom-select',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './custom-select.component.html',
    styleUrls: ['./custom-select.component.scss']
})
export class CustomSelectComponent {
    @Input() options: SelectOption[] = [];
    @Input() placeholder: string = 'Seleccionar...';
    @Input() label: string = '';

    // Support both object and primitive values
    private _value = signal<any>(null);

    @Input() set value(val: any) {
        this._value.set(val);
    }
    get value() {
        return this._value();
    }

    @Output() valueChange = new EventEmitter<any>();

    @ViewChild('triggerButton') triggerButton!: ElementRef;

    isOpen = signal(false);
    dropdownPosition = signal<{ top: number; left: number; width: number } | null>(null);

    selectedLabel = computed(() => {
        const selected = this.options.find(opt => opt.value === this.value);
        return selected ? selected.label : this.placeholder;
    });

    toggleDropdown(event: Event) {
        event.stopPropagation();
        if (this.isOpen()) {
            this.close();
        } else {
            this.open();
        }
    }

    open() {
        this.calculatePosition();
        this.isOpen.set(true);
    }

    close() {
        this.isOpen.set(false);
    }

    selectOption(option: SelectOption, event: Event) {
        event.stopPropagation();
        this.value = option.value;
        this.valueChange.emit(option.value);
        this.close();
    }

    @HostListener('document:click', ['$event'])
    onDocumentClick(event: Event) {
        if (this.isOpen() && this.triggerButton && !this.triggerButton.nativeElement.contains(event.target)) {
            this.close();
        }
    }

    @HostListener('window:resize')
    @HostListener('window:scroll')
    onWindowScroll() {
        if (this.isOpen()) {
            this.calculatePosition();
        }
    }

    private calculatePosition() {
        if (!this.triggerButton) return;

        const rect = this.triggerButton.nativeElement.getBoundingClientRect();

        this.dropdownPosition.set({
            top: rect.bottom + 4, // 4px gap
            left: rect.left,
            width: rect.width
        });
    }
}
