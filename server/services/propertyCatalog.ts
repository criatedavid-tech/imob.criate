import { supabase } from "../supabase";
import {
  buildCatalogEntry,
  flagDuplicateDescriptions,
  type CatalogEntry,
  type RawProperty,
} from "./propertyCatalogCore";

// ─────────────────────────────────────────────────────────────────────────
// Catálogo do corretor com cache — a camada de I/O do núcleo puro.
//
// Por que cache: o agente consulta o catálogo VÁRIAS vezes no mesmo turno
// (busca, depois detalha, depois compara). Sem cache, cada mensagem de cada
// conversa vira várias idas ao Supabase; com 100 corretores conversando ao
// mesmo tempo isso é o gargalo óbvio. Com TTL de 60s, o catálogo de um
// corretor é lido no máximo uma vez por minuto, não importa o volume de
// mensagens.
//
// Também há deduplicação de requisições em voo: uma rajada de mensagens do
// mesmo corretor com o cache frio dispara UMA consulta, não N.
// ─────────────────────────────────────────────────────────────────────────

const TTL_MS = Number(process.env.CATALOG_CACHE_TTL_MS) || 60_000;
const MAX_BROKERS_CACHED = 300;
const MAX_PROPERTIES_PER_BROKER = 800;

interface CacheSlot {
  at: number;
  entries: CatalogEntry[];
}

const cache = new Map<string, CacheSlot>();
const inFlight = new Map<string, Promise<CatalogEntry[]>>();

export function invalidateBrokerCatalog(brokerId: string): void {
  cache.delete(brokerId);
}

async function fetchCatalog(brokerId: string): Promise<CatalogEntry[]> {
  const { data, error } = await supabase
    .from("imf_properties")
    // Sem `description` não dá para extrair quartos/tipo (o cadastro não tem
    // campos estruturados), mas nada além destes campos é necessário.
    .select("id, title, price, location, description, image_url, slug, link, status, created_at")
    .eq("broker_id", brokerId)
    .eq("status", "disponivel")
    .order("created_at", { ascending: false })
    .limit(MAX_PROPERTIES_PER_BROKER);
  if (error) throw error;

  const entries = (data || []).map((row) => buildCatalogEntry(row as RawProperty));
  flagDuplicateDescriptions(entries);
  return entries;
}

export async function getBrokerCatalog(brokerId: string): Promise<CatalogEntry[]> {
  const hit = cache.get(brokerId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.entries;

  const pending = inFlight.get(brokerId);
  if (pending) return pending;

  const promise = fetchCatalog(brokerId)
    .then((entries) => {
      if (cache.size >= MAX_BROKERS_CACHED) {
        // Evicção simples pela entrada mais antiga: o custo de errar aqui é
        // uma consulta a mais, não um dado errado.
        const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest) cache.delete(oldest[0]);
      }
      cache.set(brokerId, { at: Date.now(), entries });
      return entries;
    })
    .finally(() => {
      inFlight.delete(brokerId);
    });

  inFlight.set(brokerId, promise);
  return promise;
}

export async function getCatalogEntry(brokerId: string, propertyId: string): Promise<CatalogEntry | null> {
  const entries = await getBrokerCatalog(brokerId);
  return entries.find((e) => e.id === propertyId) || null;
}
