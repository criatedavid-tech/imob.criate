import { supabase } from "../supabase";

// ─────────────────────────────────────────────────────────────────────────
// O imóvel como a vitrine pública precisa dele.
//
// Existe uma implementação SÓ, usada por dois caminhos:
//   - GET /api/properties/:slug (a rota que o navegador chama);
//   - a injeção no HTML de /p/:slug (para a página não precisar chamar nada).
//
// Se fossem duas cópias, uma mudaria sem a outra e a página passaria a mostrar
// um dado no primeiro instante e outro depois que a API respondesse.
//
// ⚠️ A lista de campos do corretor é ALLOWLIST explícita de propósito: o resto
// de `imf_brokers` guarda segredos (reset_token, uazapi_instance_token,
// asaas_credit_card_token, is_admin). Um `select('*')` aqui vazaria tudo isso
// para qualquer pessoa que abrisse um link de imóvel.
// ─────────────────────────────────────────────────────────────────────────

const SEPARADOR_DETALHES = "---DETALHES-GERADOS---";

export interface PublicPropertyResult {
  encontrado: boolean;
  imovel: Record<string, any> | null;
}

export async function loadPublicProperty(slug: string): Promise<PublicPropertyResult> {
  const { data, error } = await supabase
    .from("imf_properties")
    .select("*, brokers:imf_brokers(name, phone, broker_address)")
    .eq("slug", slug)
    .single();

  if (error?.code === "PGRST116") return { encontrado: false, imovel: null };
  if (error) throw error;
  if (!data) return { encontrado: false, imovel: null };

  // image_url é TEXT e guarda ou um JSON de array, ou uma URL solta.
  let imageUrlStr = data.image_url;
  let imagesArray: string[] = [];
  try {
    if (imageUrlStr && imageUrlStr.startsWith("[")) {
      imagesArray = JSON.parse(imageUrlStr);
      imageUrlStr = imagesArray[0] || "";
    } else if (imageUrlStr) {
      imagesArray = [imageUrlStr];
    }
  } catch {
    imagesArray = imageUrlStr ? [imageUrlStr] : [];
  }
  data.imageUrl = imageUrlStr;
  data.images = imagesArray;

  // Quartos, área e afins vivem num bloco JSON colado no fim da descrição.
  let cleanDescription = data.description || "";
  let details: Record<string, any> = {};
  if (cleanDescription.includes(SEPARADOR_DETALHES)) {
    const parts = cleanDescription.split(SEPARADOR_DETALHES);
    cleanDescription = parts[0].trim();
    try { details = JSON.parse(parts[1].trim()); } catch { /* bloco corrompido: segue sem detalhes */ }
  }
  data.description = cleanDescription;
  data.details = details;

  return { encontrado: true, imovel: data };
}

/**
 * Serializa para dentro de uma tag `<script>`.
 *
 * O escape de `<` NÃO é preciosismo: sem ele, uma descrição de imóvel contendo
 * `</script>` fecharia a tag e o resto do texto viraria HTML executável na
 * página. Como a descrição é digitada pelo corretor, isso é entrada de usuário.
 */
export function serializeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
