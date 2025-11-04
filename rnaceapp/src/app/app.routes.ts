import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./home/home').then(m => m.Home) },
  { path: 'settings', loadComponent: () => import('./settings/settings').then(m => m.Settings) },
  { path: '**', redirectTo: '' }
];
