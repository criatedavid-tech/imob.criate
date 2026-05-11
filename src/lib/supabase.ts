import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Property = {
  id: string;
  title: string;
  slug: string;
  description: string;
  price: number;
  location: string;
  bedrooms: number;
  bathrooms: number;
  area: number;
  images: string[];
  features: string[];
  agent_id: string;
  created_at: string;
};

export type Lead = {
  id: string;
  name: string;
  email: string;
  phone: string;
  property_id?: string;
  status: 'new' | 'contacted' | 'visited' | 'closed';
  created_at: string;
};
