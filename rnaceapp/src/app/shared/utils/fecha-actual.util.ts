export function inicioMesActual(): string {
  const ahora = new Date();
  const y = ahora.getFullYear();
  const m = (ahora.getMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}-01`;
}

export function esMesAnterior(anio: number, mes: number): boolean {
  const ahora = new Date();
  const anioActual = ahora.getFullYear();
  const mesActual = ahora.getMonth() + 1;
  return anio < anioActual || (anio === anioActual && mes < mesActual);
}
