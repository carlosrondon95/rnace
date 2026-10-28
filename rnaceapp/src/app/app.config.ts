import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withNavigationErrorHandler } from '@angular/router';
import { recuperarFalloDeChunk } from './core/recuperar-navegacion';

import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes, withNavigationErrorHandler(recuperarFalloDeChunk)),
    provideClientHydration(withEventReplay()),
  ],
};
