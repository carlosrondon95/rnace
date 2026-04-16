import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { trigger, transition, style, animate } from '@angular/animations';

@Component({
  selector: 'app-ios-install-banner',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ios-install-banner.component.html',
  styleUrls: ['./ios-install-banner.component.scss'],
  animations: [
    trigger('slideUp', [
      transition(':enter', [
        style({ transform: 'translateY(100%)', opacity: 0 }),
        animate('400ms cubic-bezier(0.16, 1, 0.3, 1)', style({ transform: 'translateY(0)', opacity: 1 }))
      ]),
      transition(':leave', [
        animate('300ms cubic-bezier(0.16, 1, 0.3, 1)', style({ transform: 'translateY(100%)', opacity: 0 }))
      ])
    ])
  ]
})
export class IosInstallBannerComponent implements OnInit {
  showBanner = signal<boolean>(false);

  ngOnInit() {
    this.checkIfShouldShowBanner();
  }

  private checkIfShouldShowBanner() {
    // Evitar errores si se procesa en el servidor o si el navegador no está definido
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return;
    }

    const isIos = () => {
      const userAgent = window.navigator.userAgent.toLowerCase();
      // Solo iPhone e iPad, evitar falsos positivos
      return /iphone|ipad|ipod/.test(userAgent);
    };

    // Detecta si la app ya está instalada (en Safari de iOS, display-mode no cuenta siempre, hay que mirar navigator.standalone)
    const isInStandaloneMode = () => {
      const nav: any = window.navigator;
      const isStandalone = ('standalone' in nav && nav.standalone) || window.matchMedia('(display-mode: standalone)').matches;
      return isStandalone;
    };

    // Comprobar si el usuario la ha cerrado antes
    const hasDismissed = localStorage.getItem('ios-install-banner-dismissed') === 'true';

    // Mostrar si estamos en iOS, la app NO está instalada y NO la ha cerrado antes
    if (isIos() && !isInStandaloneMode() && !hasDismissed) {
      // Retardo de unos segundos para que no sea tan intrusivo nada más abrir
      setTimeout(() => {
        this.showBanner.set(true);
      }, 4000); 
    }
  }

  dismissBanner() {
    this.showBanner.set(false);
    localStorage.setItem('ios-install-banner-dismissed', 'true');
  }
}
