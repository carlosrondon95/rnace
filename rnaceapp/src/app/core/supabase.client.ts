// src/app/core/supabase.client.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

let _client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!_client) {
    console.log(
      '[Supabase] Inicializando cliente con URL:',
      environment.supabaseUrl,
    );

    _client = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
      auth: {
        // Desactivamos la persistencia de sesión de Supabase Auth
        // porque usamos autenticación propia con la tabla 'usuarios'.
        // Esto evita problemas con tokens caducados que interfieren con las consultas.
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return _client;
}
