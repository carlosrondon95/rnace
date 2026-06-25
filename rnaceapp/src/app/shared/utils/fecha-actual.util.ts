export function inicioMesActual(): string {
  const ahora = new Date();
  const y = ahora.getFullYear();
  const m = (ahora.getMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}-01`;
}

// Primer día del mes siguiente al actual (formato YYYY-MM-01).
// new Date(y, mes+1, 1) gestiona el salto de diciembre a enero automáticamente.
// Construimos el string desde año/mes locales (sin toISOString) para evitar
// desfases de zona horaria.
export function inicioProximoMes(): string {
  const ahora = new Date();
  const proximo = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1);
  const y = proximo.getFullYear();
  const m = (proximo.getMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}-01`;
}

export function esMesAnterior(anio: number, mes: number): boolean {
  const ahora = new Date();
  const anioActual = ahora.getFullYear();
  const mesActual = ahora.getMonth() + 1;
  return anio < anioActual || (anio === anioActual && mes < mesActual);
}
