// Configurazione centralizzata di Supabase
const SUPABASE_URL = 'https://szybzycjdqlhpgdlcoou.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_9PWi6QX0YsUBx5RoaleQ1g_FQz82pmn';

// Crea e memorizza il client Supabase una sola volta
const supabaseClientInstance = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Esporta il client direttamente su window
window.supabaseClient = supabaseClientInstance;

// Funzione legacy per retrocompatibilità
window.createSupabaseClient = function() {
  console.warn('createSupabaseClient() è deprecata. Considera di usare window.supabaseClient direttamente in futuro');
  return window.supabaseClient;
};
