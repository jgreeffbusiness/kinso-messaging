import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabaseInstance: SupabaseClient | null = null;
let supabaseAdminInstance: SupabaseClient | null = null;

if (supabaseUrl && supabaseAnonKey) {
  supabaseInstance = createClient(supabaseUrl, supabaseAnonKey);
} else {
  console.warn(
    'Supabase URL or Anon Key is missing. Public Supabase client will not be initialized.'
  );
}

if (supabaseUrl && supabaseServiceKey) {
  supabaseAdminInstance = createClient(supabaseUrl, supabaseServiceKey);
} else {
  console.warn(
    'Supabase URL or Service Key is missing. Supabase Admin client (for server-side) will not be initialized.'
  );
}

export const supabase = supabaseInstance;
export const supabaseAdmin = supabaseAdminInstance; 