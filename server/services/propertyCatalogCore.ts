// ─────────────────────────────────────────────────────────────────────────
// Núcleo do catálogo — funções puras, sem banco, sem rede.
//
// Existe porque `imf_properties` não tem NENHUM campo estruturado: quartos,
// tipo, finalidade e área vivem dentro de um bloco JSON colado no fim da
// descrição (`---DETALHES-GERADOS---`), gerado por IA e frequentemente errado
// (quartos:0 numa casa de R$4mi, "Sala comercial" em imóvel residencial,
// descrições idênticas em imóveis diferentes).
//
// A regra que orienta tudo aqui: **dado duvidoso não vira afirmação**. Em vez
// de "limpar" o dado e fingir que está certo, cada campo carrega se é confiável
// ou não, e o que é suspeito sai do payload do agente e entra em
// `dados_incertos`. É isso que faz a IA perguntar em vez de repetir lixo.
//
// Separado de propertyCatalog.ts (que faz I/O) para poder ser testado de
// verdade, sem banco e sem variável de ambiente.
// ─────────────────────────────────────────────────────────────────────────

const DETAILS_MARKER = "---DETALHES-GERADOS---";

export interface RawProperty {
  id: string;
  title: string | null;
  price: string | null;
  location: string | null;
  description: string | null;
  image_url: string | null;
  slug: string | null;
  link: string | null;
  status: string | null;
  broker_id?: string | null;
  created_at?: string | null;
}

export type PropertyKind = "casa" | "apartamento" | "comercial" | "terreno" | "indefinido";
export type Purpose = "venda" | "aluguel" | "indefinido";

interface QualityIssue {
  campo: string;
  gravidade: "alta" | "media";
  problema: string;
  sugestao: string;
}

export interface CatalogEntry {
  id: string;
  titulo: string;
  local: string;
  linkPublico: string | null;
  precoCents: number | null;
  precoTexto: string | null;
  tipo: PropertyKind;
  tipoConfiavel: boolean;
  finalidade: Purpose;
  quartos: number | null;
  banheiros: number | null;
  areaM2: number | null;
  vagas: number | null;
  destaques: string[];
  resumo: string;
  temFotos: boolean;
  qtdFotos: number;
  /** Campos que NÃO podem ser afirmados ao cliente (dado ausente ou contraditório). */
  camposIncertos: string[];
  problemas: QualityIssue[];
  /** Texto normalizado para busca (título + local). */
  buscaTexto: string;
  criadoEm: string | null;
}

// ─── Preço ──────────────────────────────────────────────────────────────────

/**
 * Converte preço em texto livre para centavos.
 *
 * O campo `price` é TEXT e chega em formatos variados. A regra brasileira que
 * resolve a ambiguidade: se existe vírgula, o que vem depois dela são os
 * centavos; ponto é sempre separador de milhar. Sem vírgula, o número é
 * inteiro em reais — "R$ 350.000" são trezentos e cinquenta mil, não R$ 3.500.
 * Errar isso faz a IA oferecer um imóvel de R$ 3 mil para quem pediu R$ 350 mil.
 */
export function parsePriceToCents(price: string | null | undefined): number | null {
  if (price === null || price === undefined) return null;
  const raw = String(price).trim();
  if (!raw) return null;

  const digitsAndSeparators = raw.replace(/[^\d.,]/g, "");
  if (!digitsAndSeparators || !/\d/.test(digitsAndSeparators)) return null;

  const lastComma = digitsAndSeparators.lastIndexOf(",");
  let reaisPart: string;
  let centsPart = "00";

  if (lastComma >= 0) {
    const decimals = digitsAndSeparators.slice(lastComma + 1).replace(/\D/g, "");
    // "1.200,5" é meio real; "1.200,50" são cinquenta centavos.
    centsPart = (decimals + "00").slice(0, 2);
    reaisPart = digitsAndSeparators.slice(0, lastComma);
  } else {
    reaisPart = digitsAndSeparators;
  }

  const reais = reaisPart.replace(/\D/g, "");
  if (!reais) return null;
  const cents = Number(reais) * 100 + Number(centsPart);
  if (!Number.isFinite(cents) || cents <= 0) return null;
  return cents;
}

export function formatCents(cents: number | null): string | null {
  if (cents === null) return null;
  return (cents / 100)
    .toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    .replace(/\u00a0/g, " ");
}

// ─── Texto ──────────────────────────────────────────────────────────────────

export function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Palavras que aparecem em quase todo endereço brasileiro e não distinguem
// nada. Sem removê-las, "Setor Oeste" casaria com "Setor Bueno" pelo "setor".
const LOCATION_STOPWORDS = new Set([
  "setor", "rua", "av", "avenida", "alameda", "travessa", "praca", "bairro",
  "jardim", "vila", "residencial", "condominio", "conjunto", "quadra", "lote",
  "casa", "apartamento", "apto", "ap", "de", "da", "do", "das", "dos", "em",
  "no", "na", "perto", "proximo", "proxima", "regiao", "zona", "cidade",
  "referencia", "ref",
]);

function significantTokens(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !LOCATION_STOPWORDS.has(token));
}

// ─── Bloco de detalhes gerado por IA ────────────────────────────────────────

interface ParsedDescription {
  /** Texto que o humano escreveu/gerou, sem o bloco técnico. */
  texto: string;
  detalhes: Record<string, unknown>;
  temBloco: boolean;
}

function parsePropertyDetails(description: string | null | undefined): ParsedDescription {
  const full = String(description ?? "");
  const markerIndex = full.indexOf(DETAILS_MARKER);
  if (markerIndex < 0) return { texto: full.trim(), detalhes: {}, temBloco: false };

  const texto = full.slice(0, markerIndex).trim();
  const rest = full.slice(markerIndex + DETAILS_MARKER.length).trim();
  try {
    const parsed = JSON.parse(rest);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { texto, detalhes: parsed as Record<string, unknown>, temBloco: true };
    }
  } catch {
    // Bloco corrompido não pode derrubar a busca — vira "sem detalhes".
  }
  return { texto, detalhes: {}, temBloco: true };
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isYes(value: unknown): boolean {
  return normalizeText(String(value ?? "")) === "sim";
}

// ─── Tipo e finalidade ──────────────────────────────────────────────────────

/**
 * O `tipo_imovel` do bloco gerado é pouco confiável (aparece "Sala comercial"
 * em `tipo_comercial` de casas residenciais). Cruzamos título, texto e bloco;
 * quando as pistas se contradizem, devolvemos `confiavel: false` — e aí o
 * agente pergunta em vez de afirmar.
 */
function inferPropertyType(
  title: string | null,
  texto: string,
  detalhes: Record<string, unknown>,
): { tipo: PropertyKind; confiavel: boolean } {
  const tituloNorm = normalizeText(title);
  const textoNorm = normalizeText(texto).slice(0, 600);

  const pistas = new Set<PropertyKind>();
  if (/\bapartamento\b|\bapto\b|\bap\b|\bflat\b|\bstudio\b|\bcobertura\b/.test(tituloNorm)) pistas.add("apartamento");
  if (/\bcasa\b|\bsobrado\b|\bresidencia\b/.test(tituloNorm)) pistas.add("casa");
  if (/\bsala\b|\bloja\b|\bgalpao\b|\bcomercial\b|\bescritorio\b/.test(tituloNorm)) pistas.add("comercial");
  if (/\bterreno\b|\blote\b|\barea\b/.test(tituloNorm)) pistas.add("terreno");

  const pistasTexto = new Set<PropertyKind>();
  if (/\bapartamento\b|\bcobertura\b|\bunidade\b/.test(textoNorm)) pistasTexto.add("apartamento");
  if (/\bcasa\b|\bresidencia\b|\bsobrado\b/.test(textoNorm)) pistasTexto.add("casa");
  if (/\bsala comercial\b|\bgalpao\b|\bloja\b/.test(textoNorm)) pistasTexto.add("comercial");

  const doBloco = normalizeText(String(detalhes.tipo_imovel ?? ""));
  const blocoKind: PropertyKind | null =
    doBloco === "comercial" ? "comercial"
      : doBloco === "residencial" ? null // "residencial" não diz casa vs apartamento
        : null;

  // Título manda (é o que o corretor escreveu de próprio punho).
  if (pistas.size === 1) {
    const tipo = [...pistas][0];
    // Contradição real: título diz apartamento e o texto descreve uma casa.
    const contradiz =
      (tipo === "apartamento" && pistasTexto.has("casa") && !pistasTexto.has("apartamento")) ||
      (tipo === "casa" && pistasTexto.has("apartamento") && !pistasTexto.has("casa")) ||
      (tipo !== "comercial" && blocoKind === "comercial");
    return { tipo, confiavel: !contradiz };
  }

  if (pistas.size > 1) return { tipo: [...pistas][0], confiavel: false };
  if (pistasTexto.size === 1) return { tipo: [...pistasTexto][0], confiavel: false };
  if (blocoKind) return { tipo: blocoKind, confiavel: false };
  return { tipo: "indefinido", confiavel: false };
}

function inferPurpose(detalhes: Record<string, unknown>, texto: string): Purpose {
  const doBloco = normalizeText(String(detalhes.finalidade ?? ""));
  if (doBloco === "venda") return "venda";
  if (doBloco === "aluguel" || doBloco === "locacao") return "aluguel";
  const textoNorm = normalizeText(texto);
  if (/\baluguel\b|\balugar\b|\blocacao\b|\bpor mes\b/.test(textoNorm)) return "aluguel";
  if (/\bvenda\b|\bvender\b|\bcomprar\b/.test(textoNorm)) return "venda";
  return "indefinido";
}

// ─── Qualidade do dado ──────────────────────────────────────────────────────

const GENERIC_DESCRIPTION_FINGERPRINT = normalizeText(
  "Apresentamos esta belíssima residência, ideal para quem busca conforto, praticidade e qualidade de vida",
).slice(0, 80);

/**
 * Lista os problemas do cadastro em português de gente. Não tenta adivinhar o
 * valor certo — só denuncia o que não dá para afirmar. Cada problema vira
 * aviso na tela do corretor E remove o campo do payload do agente.
 */
function assessPropertyQuality(
  raw: RawProperty,
  parsed: ParsedDescription,
  tipo: { tipo: PropertyKind; confiavel: boolean },
  precoCents: number | null,
  fotos: number,
): { problemas: QualityIssue[]; camposIncertos: string[] } {
  const problemas: QualityIssue[] = [];
  const incertos = new Set<string>();
  const d = parsed.detalhes;
  const comercial = tipo.tipo === "comercial" || tipo.tipo === "terreno";

  if (precoCents === null) {
    problemas.push({
      campo: "preco",
      gravidade: "alta",
      problema: "O preço está vazio ou num formato que o sistema não consegue ler.",
      sugestao: 'Preencha como "R$ 350.000,00".',
    });
    incertos.add("preco");
  }

  const quartos = numberOrNull(d.quartos);
  if (!comercial && (quartos === null || quartos === 0)) {
    problemas.push({
      campo: "quartos",
      gravidade: "alta",
      problema: "O imóvel está sem número de quartos (consta 0 ou vazio).",
      sugestao: "Informe os quartos — é o primeiro filtro de quase todo cliente.",
    });
    incertos.add("quartos");
  }

  const banheiros = numberOrNull(d.banheiros);
  if (!comercial && (banheiros === null || banheiros === 0)) {
    problemas.push({
      campo: "banheiros",
      gravidade: "media",
      problema: "O imóvel está sem número de banheiros.",
      sugestao: "Informe os banheiros para a IA poder responder sem chutar.",
    });
    incertos.add("banheiros");
  }

  const area = numberOrNull(d.area);
  if (area === null || area === 0) {
    problemas.push({
      campo: "area",
      gravidade: "media",
      problema: "O imóvel está sem área (consta 0 ou vazio).",
      sugestao: "Informe a área em metros quadrados.",
    });
    incertos.add("area");
  }

  if (!tipo.confiavel) {
    problemas.push({
      campo: "tipo",
      gravidade: "alta",
      problema: "O título, a descrição e os detalhes discordam sobre o tipo do imóvel (casa, apartamento ou comercial).",
      sugestao: "Alinhe o título com a descrição — a IA não consegue afirmar o tipo assim.",
    });
    incertos.add("tipo");
  }

  // "Sala comercial" carimbado em imóvel residencial é o erro mais comum do
  // gerador automático de detalhes.
  if (!comercial && d.tipo_comercial && normalizeText(String(d.tipo_comercial))) {
    problemas.push({
      campo: "tipo_comercial",
      gravidade: "media",
      problema: `Imóvel residencial marcado como "${String(d.tipo_comercial)}" no campo comercial.`,
      sugestao: "Limpe esse campo — ele confunde a busca da IA.",
    });
  }

  const textoNorm = normalizeText(parsed.texto);
  if (parsed.texto.trim().length < 60) {
    problemas.push({
      campo: "descricao",
      gravidade: "alta",
      problema: "A descrição é curta demais para a IA ter o que dizer sobre o imóvel.",
      sugestao: "Escreva ao menos algumas linhas com o que o imóvel tem de diferente.",
    });
  } else if (textoNorm.startsWith(GENERIC_DESCRIPTION_FINGERPRINT)) {
    problemas.push({
      campo: "descricao",
      gravidade: "alta",
      problema: "A descrição é o texto genérico padrão, igual ao de outros imóveis.",
      sugestao: "Reescreva com o que este imóvel tem de específico — senão a IA fala igual de todos.",
    });
  }

  const local = String(raw.location ?? "");
  if (/refer[eê]ncia/i.test(local) || /\d{6,}/.test(local)) {
    problemas.push({
      campo: "location",
      gravidade: "media",
      problema: "A localização tem código interno de referência junto com o endereço.",
      sugestao: "Deixe só bairro e cidade — o código vaza para o cliente.",
    });
  }

  if (fotos === 0) {
    problemas.push({
      campo: "fotos",
      gravidade: "alta",
      problema: "O imóvel não tem nenhuma foto.",
      sugestao: "Sem foto o cliente quase nunca avança para a visita.",
    });
  }

  return { problemas, camposIncertos: [...incertos] };
}

// ─── Montagem da entrada de catálogo ────────────────────────────────────────

function countPhotos(imageUrl: string | null | undefined): number {
  if (!imageUrl) return 0;
  try {
    const parsed = JSON.parse(imageUrl);
    if (Array.isArray(parsed)) return parsed.filter(Boolean).length;
  } catch {
    // Campo pode ser uma URL única em texto puro.
  }
  return String(imageUrl).trim() ? 1 : 0;
}

function buildSummary(texto: string, limit = 240): string {
  const clean = texto
    .replace(/\*\*/g, "")
    .replace(/[#>*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (lastStop > limit * 0.5 ? cut.slice(0, lastStop + 1) : cut).trim() + "…";
}

const FEATURE_RULES: { chave: string; rotulo: string; campo?: string; regex?: RegExp }[] = [
  { chave: "piscina", rotulo: "piscina", campo: "piscina", regex: /\bpiscina\b/ },
  { chave: "varanda_gourmet", rotulo: "varanda gourmet", campo: "varanda_gourmet", regex: /\bvaranda gourmet\b/ },
  { chave: "churrasqueira", rotulo: "churrasqueira", regex: /\bchurrasqueira\b/ },
  { chave: "mobiliado", rotulo: "mobiliado", regex: /\bmobiliad[oa]\b/ },
  { chave: "academia", rotulo: "academia", regex: /\bacademia\b/ },
  { chave: "portaria", rotulo: "portaria 24h", regex: /\bportaria\b/ },
  { chave: "condominio_fechado", rotulo: "condomínio fechado", regex: /\bcondominio fechado\b/ },
  { chave: "vista", rotulo: "vista panorâmica", regex: /\bvista (panoramica|para o mar|privilegiada)\b/ },
];

export function buildCatalogEntry(raw: RawProperty): CatalogEntry {
  const parsed = parsePropertyDetails(raw.description);
  const precoCents = parsePriceToCents(raw.price);
  const tipo = inferPropertyType(raw.title, parsed.texto, parsed.detalhes);
  const fotos = countPhotos(raw.image_url);
  const { problemas, camposIncertos } = assessPropertyQuality(raw, parsed, tipo, precoCents, fotos);

  const textoNorm = normalizeText(parsed.texto);
  const destaques: string[] = [];
  for (const rule of FEATURE_RULES) {
    const porCampo = rule.campo ? isYes(parsed.detalhes[rule.campo]) : false;
    const porTexto = rule.regex ? rule.regex.test(textoNorm) : false;
    // Só afirma o diferencial quando as duas pistas concordam ou quando só
    // existe uma. Campo dizendo "Não" e texto dizendo que tem = não afirma.
    if (rule.campo && parsed.detalhes[rule.campo] !== undefined) {
      if (porCampo) destaques.push(rule.rotulo);
    } else if (porTexto) {
      destaques.push(rule.rotulo);
    }
  }

  const vagas = numberOrNull(parsed.detalhes.vagas_garagem);
  if (vagas && vagas > 0) destaques.push(`${vagas} vaga${vagas > 1 ? "s" : ""} de garagem`);

  const incertos = new Set(camposIncertos);
  const quartos = numberOrNull(parsed.detalhes.quartos);
  const banheiros = numberOrNull(parsed.detalhes.banheiros);
  const area = numberOrNull(parsed.detalhes.area);

  return {
    id: raw.id,
    titulo: String(raw.title ?? "").trim() || "(sem título)",
    local: String(raw.location ?? "").trim(),
    linkPublico: raw.link || (raw.slug ? `/p/${raw.slug}` : null),
    precoCents,
    precoTexto: formatCents(precoCents),
    tipo: tipo.tipo,
    tipoConfiavel: tipo.confiavel,
    finalidade: inferPurpose(parsed.detalhes, parsed.texto),
    quartos: incertos.has("quartos") ? null : quartos,
    banheiros: incertos.has("banheiros") ? null : banheiros,
    areaM2: incertos.has("area") ? null : area,
    vagas,
    destaques,
    resumo: buildSummary(parsed.texto),
    temFotos: fotos > 0,
    qtdFotos: fotos,
    camposIncertos: [...incertos],
    problemas,
    buscaTexto: `${normalizeText(raw.title)} ${normalizeText(raw.location)}`.trim(),
    criadoEm: raw.created_at ?? null,
  };
}

/**
 * Descrição genérica repetida só é detectável comparando os imóveis entre si.
 * Roda depois de montar todas as entradas, sobre o catálogo do corretor.
 */
export function flagDuplicateDescriptions(entries: CatalogEntry[]): void {
  const byFingerprint = new Map<string, CatalogEntry[]>();
  for (const entry of entries) {
    const fingerprint = normalizeText(entry.resumo).slice(0, 120);
    if (fingerprint.length < 40) continue;
    const list = byFingerprint.get(fingerprint) || [];
    list.push(entry);
    byFingerprint.set(fingerprint, list);
  }
  for (const group of byFingerprint.values()) {
    if (group.length < 2) continue;
    for (const entry of group) {
      if (entry.problemas.some((p) => p.campo === "descricao")) continue;
      entry.problemas.push({
        campo: "descricao",
        gravidade: "alta",
        problema: `A descrição é idêntica à de outros ${group.length - 1} imóvel(is) seus.`,
        sugestao: "Descreva o que este tem de diferente — a IA não consegue diferenciar os dois.",
      });
    }
  }
}

// ─── Busca ──────────────────────────────────────────────────────────────────

export interface SearchCriteria {
  finalidade?: Purpose | null;
  regiao?: string | null;
  tipo?: PropertyKind | null;
  quartosMin?: number | null;
  precoMinCents?: number | null;
  precoMaxCents?: number | null;
  diferenciais?: string[] | null;
  limite?: number;
}

export interface SearchHit {
  entry: CatalogEntry;
  /** Critérios pedidos que este imóvel NÃO atende, em português. */
  naoBate: string[];
  /** Critérios que não dá para verificar porque o cadastro está incompleto. */
  naoVerificavel: string[];
  score: number;
}

export interface SearchResult {
  totalNoCatalogo: number;
  encontrouExatos: boolean;
  resultados: SearchHit[];
  /** Critérios que nenhum imóvel do catálogo atendeu. */
  gargalos: string[];
}

const CRITERION_LABEL: Record<string, string> = {
  finalidade: "finalidade (compra/aluguel)",
  regiao: "região",
  tipo: "tipo de imóvel",
  quartos: "número de quartos",
  preco: "faixa de preço",
  diferenciais: "diferenciais pedidos",
};

function regionScore(entry: CatalogEntry, regiao: string): number {
  const alvo = normalizeText(regiao);
  if (!alvo) return 1;
  if (entry.buscaTexto.includes(alvo)) return 1;

  const tokensAlvo = significantTokens(regiao);
  if (!tokensAlvo.length) return 0;
  const encontrados = tokensAlvo.filter((token) => entry.buscaTexto.includes(token));
  if (!encontrados.length) return 0;
  return encontrados.length / tokensAlvo.length;
}

/**
 * Em vez de "relaxar filtros em ordem", cada imóvel é avaliado contra TODOS os
 * critérios e carrega a lista do que não bate. Quando não há match exato, o
 * agente recebe os mais próximos já sabendo dizer o que não bate — que é como
 * um corretor de verdade responde ("não tenho na Santo Amaro, mas tenho no
 * Setor Oeste"), em vez de empurrar qualquer coisa.
 */
export function searchCatalog(entries: CatalogEntry[], criteria: SearchCriteria): SearchResult {
  const limite = Math.min(Math.max(criteria.limite ?? 3, 1), 8);
  const hits: SearchHit[] = [];

  for (const entry of entries) {
    const naoBate: string[] = [];
    const naoVerificavel: string[] = [];
    let score = 0;

    if (criteria.finalidade && criteria.finalidade !== "indefinido") {
      if (entry.finalidade === "indefinido") naoVerificavel.push(CRITERION_LABEL.finalidade);
      else if (entry.finalidade !== criteria.finalidade) naoBate.push(CRITERION_LABEL.finalidade);
      else score += 3;
    }

    if (criteria.regiao) {
      const rs = regionScore(entry, criteria.regiao);
      if (rs === 0) naoBate.push(CRITERION_LABEL.regiao);
      else score += 4 * rs;
    }

    if (criteria.tipo && criteria.tipo !== "indefinido") {
      if (!entry.tipoConfiavel || entry.tipo === "indefinido") naoVerificavel.push(CRITERION_LABEL.tipo);
      else if (entry.tipo !== criteria.tipo) naoBate.push(CRITERION_LABEL.tipo);
      else score += 3;
    }

    if (criteria.quartosMin) {
      if (entry.quartos === null) naoVerificavel.push(CRITERION_LABEL.quartos);
      else if (entry.quartos < criteria.quartosMin) naoBate.push(CRITERION_LABEL.quartos);
      else score += 2;
    }

    if (criteria.precoMaxCents || criteria.precoMinCents) {
      if (entry.precoCents === null) {
        naoVerificavel.push(CRITERION_LABEL.preco);
      } else {
        const acimaDoTeto = criteria.precoMaxCents ? entry.precoCents > criteria.precoMaxCents : false;
        const abaixoDoPiso = criteria.precoMinCents ? entry.precoCents < criteria.precoMinCents : false;
        if (acimaDoTeto || abaixoDoPiso) naoBate.push(CRITERION_LABEL.preco);
        else score += 3;
      }
    }

    if (criteria.diferenciais?.length) {
      const pedidos = criteria.diferenciais.map(normalizeText).filter(Boolean);
      const tem = pedidos.filter((p) =>
        entry.destaques.some((d) => normalizeText(d).includes(p)) || normalizeText(entry.resumo).includes(p),
      );
      if (!tem.length) naoBate.push(CRITERION_LABEL.diferenciais);
      else score += 2 * (tem.length / pedidos.length);
    }

    // Desempate: cadastro completo e com foto vale mais — evita empurrar o
    // imóvel de dado podre quando existe um equivalente bem cadastrado.
    score += entry.temFotos ? 0.5 : 0;
    score -= entry.camposIncertos.length * 0.25;

    hits.push({ entry, naoBate, naoVerificavel, score });
  }

  const exatos = hits.filter((h) => h.naoBate.length === 0);
  const ordenar = (a: SearchHit, b: SearchHit) =>
    a.naoBate.length !== b.naoBate.length ? a.naoBate.length - b.naoBate.length : b.score - a.score;

  if (exatos.length) {
    return {
      totalNoCatalogo: entries.length,
      encontrouExatos: true,
      resultados: exatos.sort(ordenar).slice(0, limite),
      gargalos: [],
    };
  }

  const proximos = hits.sort(ordenar).slice(0, limite);
  // Critério que TODO imóvel do catálogo deixou de atender: é isso que o agente
  // precisa dizer ("nessa região eu não tenho nada").
  const gargalos = hits.length
    ? [...new Set(hits[0].naoBate)].filter((criterio) => hits.every((h) => h.naoBate.includes(criterio)))
    : [];

  return { totalNoCatalogo: entries.length, encontrouExatos: false, resultados: proximos, gargalos };
}

// ─── Payload enxuto para o agente ───────────────────────────────────────────

/**
 * O que vai para o modelo. Sem image_url (eram ~10 URLs longas por imóvel,
 * a maior parte dos ~10 mil tokens que iam em toda mensagem), sem created_at,
 * sem owner_user_id. Campo incerto não aparece como valor — aparece em
 * `dados_incertos`, para a IA perguntar em vez de afirmar.
 */
export function toAgentProperty(hit: SearchHit): Record<string, unknown> {
  const e = hit.entry;
  const out: Record<string, unknown> = {
    id: e.id,
    titulo: e.titulo,
    local: e.local || "(localização não informada)",
    preco: e.precoTexto ?? "(preço não informado)",
    resumo: e.resumo,
  };
  if (e.tipoConfiavel && e.tipo !== "indefinido") out.tipo = e.tipo;
  if (e.quartos !== null) out.quartos = e.quartos;
  if (e.banheiros !== null) out.banheiros = e.banheiros;
  if (e.areaM2 !== null) out.area_m2 = e.areaM2;
  if (e.destaques.length) out.destaques = e.destaques;
  if (e.linkPublico) out.link = e.linkPublico;
  out.tem_fotos = e.temFotos;
  if (e.camposIncertos.length) out.dados_incertos = e.camposIncertos;
  if (hit.naoBate.length) out.nao_bate = hit.naoBate;
  if (hit.naoVerificavel.length) out.nao_da_para_verificar = hit.naoVerificavel;
  return out;
}

/**
 * Panorama curto do catálogo (poucas dezenas de tokens). Dá ao agente noção do
 * que existe antes de prometer qualquer coisa — sem isso ele fica cego e chuta.
 */
export function summarizeCatalog(entries: CatalogEntry[]): Record<string, unknown> {
  if (!entries.length) return { total: 0 };
  const precos = entries.map((e) => e.precoCents).filter((p): p is number => p !== null).sort((a, b) => a - b);
  const regioes = [...new Set(entries.map((e) => e.local).filter(Boolean))].slice(0, 12);
  const tipos = entries.reduce<Record<string, number>>((acc, e) => {
    const key = e.tipoConfiavel ? e.tipo : "indefinido";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return {
    total: entries.length,
    faixa_de_preco: precos.length
      ? { min: formatCents(precos[0]), max: formatCents(precos[precos.length - 1]) }
      : null,
    regioes,
    tipos,
    com_cadastro_incompleto: entries.filter((e) => e.camposIncertos.length > 0).length,
  };
}
