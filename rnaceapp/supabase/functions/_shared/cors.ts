// Helper compartido de CORS para todas las Edge Functions del proyecto.
// Centraliza la whitelist de orígenes permitidos en un único sitio.

const ALLOWED_ORIGINS = [
  'https://centrornace.com',
  'https://centrornace.netlify.app',
  'http://localhost:4200',
];

const FALLBACK_ORIGIN = ALLOWED_ORIGINS[0];

const BASE_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-rnace-token',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Vary': 'Origin',
};

/**
 * Devuelve los headers CORS apropiados para el request.
 * - Si el Origin está en la whitelist → devuelve ese mismo origen.
 * - Si no está o no hay Origin → devuelve el origen canónico (el navegador
 *   bloqueará la respuesta si el request venía de otro dominio).
 *
 * Nota: CORS sólo protege contra navegadores. Un atacante con curl/Postman
 * ignorará estos headers; por eso CORS es defensa adicional, no la principal.
 */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : FALLBACK_ORIGIN;

  return {
    ...BASE_HEADERS,
    'Access-Control-Allow-Origin': allowedOrigin,
  };
}
