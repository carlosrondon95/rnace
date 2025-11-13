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
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return _client;
}
