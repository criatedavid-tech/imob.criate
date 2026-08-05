import express from "express";
import { supabase } from "../supabase";
import { requireUser, optionalUser, getBrokerId, isBrokerOwner } from "../middleware/auth";
import { PUBLIC_APP_URL } from "../config";
import { requireInternalToken } from "../middleware/internalAuth";
import { n8nInternalLimiter, publicReadLimiter } from "../middleware/rateLimits";
import {
  N8nInputValidationError,
  parseN8nPropertyCatalog,
} from "../security/n8nGuardrails";
import { isValidPublicPropertySlug } from "../security/publicPropertySlug";
import { getBrokerCatalog, invalidateBrokerCatalog } from "../services/propertyCatalog";

export const propertiesRouter = express.Router();

const cleanCatalogText = (value: unknown, max: number) => String(value || '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
  .trim()
  .slice(0, max);

// Catálogo mínimo para o n8n. Evita entregar uma credencial Supabase ao
// workflow e impede que cada mensagem carregue SELECT * sem limite.
propertiesRouter.get(
  "/api/properties/n8n/catalog",
  requireInternalToken,
  n8nInternalLimiter,
  async (req, res) => {
    try {
      const { broker_id, limit } = parseN8nPropertyCatalog(req.query);
      const { data, error } = await supabase
        .from('imf_properties')
        .select('id, title, price, location, description, slug, link, status, updated_at')
        .eq('broker_id', broker_id)
        .eq('status', 'disponivel')
        .order('updated_at', { ascending: false })
        .limit(limit);
      if (error) throw error;

      return res.json((data || []).map((property: any) => ({
        id: property.id,
        title: cleanCatalogText(property.title, 160),
        price: cleanCatalogText(property.price, 80),
        location: cleanCatalogText(property.location, 240),
        description: cleanCatalogText(
          String(property.description || '').split('---DETALHES-GERADOS---')[0],
          1_000,
        ),
        link: cleanCatalogText(property.link, 2_048),
      })));
    } catch (err) {
      if (err instanceof N8nInputValidationError) {
        return res.status(400).json({ error: err.message });
      }
      console.error("Erro GET /api/properties/n8n/catalog:", err);
      return res.status(500).json({ error: "Falha interna ao carregar catálogo." });
    }
  },
);

// --- ROTAS DE PROPRIEDADES (IMÓVEIS) ---
/**
 * Lista todos os imóveis associados ao usuário logado.
 */
propertiesRouter.get("/api/properties", optionalUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    // Sem usuário válido (token ausente/expirado): nunca retorna a tabela
    // inteira sem filtro — isso vazaria imóveis de TODOS os corretores da
    // plataforma. A landing pública usa /api/properties/:slug, não esta rota.
    if (!userId) return res.json([]);

    const query = supabase.from('imf_properties').select('*');

    const brokerId = await getBrokerId(userId);
    if (brokerId) {
      query.eq('broker_id', brokerId);
      // Isolamento por membro: dono vê a carteira toda, membro só a própria.
      if (!(await isBrokerOwner(userId, brokerId))) {
        query.eq('owner_user_id', userId);
      }
    } else {
      query.eq('broker_id', '00000000-0000-0000-0000-000000000000'); // Force empty if no broker
    }

    const { data, error } = await query;
    if (error) throw error;

    const formattedData = (data || []).map(p => {
      // --- Parse de imagens ---
      let imageUrlStr = p.image_url;
      let imagesArray: string[] = [];
      try {
        if (imageUrlStr && imageUrlStr.startsWith('[')) {
           imagesArray = JSON.parse(imageUrlStr);
           imageUrlStr = imagesArray[0] || '';
        } else if (imageUrlStr) {
           imagesArray = [imageUrlStr];
        }
      } catch(e) {
           imagesArray = imageUrlStr ? [imageUrlStr] : [];
      }

      // --- Parse de campos estruturados embutidos na descrição ---
      // O PropertyForm salva: "{descrição limpa}\n\n---DETALHES-GERADOS---\n{JSON}"
      // Aqui separamos para que consumidores (N8N, frontend) recebam dados organizados.
      let cleanDescription = p.description || '';
      let details: Record<string, any> = {};
      const SEPARATOR = '---DETALHES-GERADOS---';
      if (cleanDescription.includes(SEPARATOR)) {
        const parts = cleanDescription.split(SEPARATOR);
        cleanDescription = parts[0].trim();
        try {
          details = JSON.parse(parts[1].trim());
        } catch { /* JSON malformado - ignora */ }
      }

      return {
        ...p,
        description: cleanDescription,   // texto limpo, sem o bloco JSON
        details,                          // { quartos, sala, cozinha, piscina, banheiros, area, varanda_gourmet }
        imageUrl: imageUrlStr,
        images: imagesArray,
      };
    });

    res.json(formattedData);
  } catch (err: any) {
    console.error("Erro GET /api/properties:", err);
    res.status(500).json({ error: err.message });
  }
});

propertiesRouter.post("/api/properties", requireUser, async (req, res) => {
  try {
    let property = req.body;
    const imgCount = Array.isArray(property.images) ? property.images.length : (property.imageUrl ? 1 : 0);
    console.log(`POST /api/properties: title="${property.title}" price="${property.price}" imgs=${imgCount}`);

    // Mapeamento de campos do frontend para o banco de dados
    if (property.images !== undefined) {
      property.image_url = JSON.stringify(property.images);
    } else if (property.imageUrl !== undefined) {
      property.image_url = property.imageUrl;
    }

    delete property.images;
    delete property.imageUrl;


    if (!property.slug) {
      const slugBase = (property.title || '').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      property.slug = `${slugBase}-${Math.random().toString(36).substring(2, 6)}`;
    }

    // --- GERAÇÃO DO LINK DA LANDING PAGE ---
    /**
     * Gera o link completo da landing page exclusiva do imóvel.
     * O link segue o padrão: https://[dominio]/p/[slug-do-imovel]
     *
     * Usa sempre PUBLIC_APP_URL (configurado no servidor), nunca o header
     * Origin/Referer do cliente — uma sessão local (npm run dev) gravando
     * contra o Supabase de produção contaminava o link pra sempre com
     * "localhost" (achado em 9 dos 12 imóveis da plataforma, 2026-07-14).
     */
    const cleanOrigin = PUBLIC_APP_URL;
    property.link = `${cleanOrigin}/p/${property.slug}`;

    // Link to broker
    const userId = (req as any).userId as string;
    if (!userId) {
      return res.status(401).json({ error: "O usuário não está autenticado e não pode salvar o imóvel." });
    }
    const brokerId = await getBrokerId(userId);
    if (!brokerId) {
      console.error("Could not associate property with a broker (no broker found or created)");
      return res.status(403).json({ error: "Sua conta não possui um perfil de corretor para cadastrar imóveis. Tente fazer login novamente." });
    }
    property.broker_id = brokerId;

    // Isolamento por membro: em edição (id presente), só o dono do imóvel ou
    // o dono da conta pode alterar — e a posse original nunca muda de mãos.
    // Em criação, quem cadastra vira o dono.
    if (property.id) {
      const { data: existing } = await supabase.from('imf_properties').select('broker_id, owner_user_id').eq('id', property.id).maybeSingle();
      if (!existing || existing.broker_id !== brokerId) {
        return res.status(403).json({ error: "Imóvel não encontrado na sua carteira." });
      }
      if (existing.owner_user_id && existing.owner_user_id !== userId && !(await isBrokerOwner(userId, brokerId))) {
        return res.status(403).json({ error: "Você não tem permissão para editar este imóvel." });
      }
      property.owner_user_id = existing.owner_user_id || userId;
    } else {
      property.owner_user_id = userId;
    }

    console.log("Upserting property with landing page link:", property.link);

    // Lista de colunas permitidas no banco de dados (Whitelisting)
    // Adicionada a coluna 'link' para persistência da URL da Landing Page
    const validColumns = [
      'id',
      'title',
      'price',
      'location',
      'description',
      'image_url',
      'slug',
      'created_at',
      'updated_at',
      'broker_id',
      'owner_user_id',
      'link',
      'status'
    ];

    const filteredProperty = Object.keys(property)
      .filter(key => validColumns.includes(key))
      .reduce((obj: any, key) => {
        obj[key] = property[key];
        return obj;
      }, {});

    const { data, error } = await supabase.from('imf_properties').upsert(filteredProperty).select().single();

    if (error) {
      console.error("Supabase error upserting property:", error);
      throw error;
    }

    if (data) {
      data.imageUrl = data.image_url;
    }

    // O catálogo do agente é cacheado por 60s; sem isto a IA continuaria
    // oferecendo o imóvel antigo (ou ignorando o novo) por um minuto.
    if (data?.broker_id) invalidateBrokerCatalog(data.broker_id);

    res.json(data);
  } catch (err: any) {
    console.error("Erro POST /api/properties:", err);
    res.status(500).json({ error: err.message || "Unknown server error" });
  }
});

propertiesRouter.get("/api/properties/health", async (req, res) => {
  try {
    const { data, error } = await supabase.from('imf_properties').select('id').limit(1);
    if (error) throw error;
    res.json({
      database: "CONNECTED",
      supabase_api: "CONNECTED",
      message: "Node.js Backend via Supabase"
    });
  } catch (err: any) {
    // Rota pública sem auth — nunca devolver detalhe interno (mensagem crua
    // do Postgres/Supabase, objeto de erro completo). O detalhe fica só no
    // log do servidor; quem chama essa rota só precisa saber que falhou.
    console.error("[Health] falha ao conectar no Supabase:", err.message || err);
    res.status(503).json({
      database: "ERROR",
      supabase_api: "ERROR",
      message: "Node.js Backend via Supabase (Error)"
    });
  }
});

// Diagnóstico do cadastro. A IA só consegue ser boa até onde o dado deixa: um
// imóvel com quartos:0 e descrição genérica faz ela falar igual de todos e
// repetir número errado. Aqui o corretor vê exatamente o que precisa arrumar.
// Precisa vir ANTES de /api/properties/:slug, senão "qualidade" vira um slug.
propertiesRouter.get("/api/properties/qualidade", requireUser, async (req, res) => {
  try {
    const brokerId = await getBrokerId((req as any).userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const entries = await getBrokerCatalog(brokerId);
    const comProblema = entries.filter((e) => e.problemas.length > 0);
    const graves = comProblema.filter((e) => e.problemas.some((p) => p.gravidade === "alta"));

    res.json({
      total: entries.length,
      com_problema: comProblema.length,
      graves: graves.length,
      // Ranking do que mais se repete: diz por onde começar a arrumar.
      mais_comuns: Object.entries(
        entries.flatMap((e) => e.problemas).reduce<Record<string, number>>((acc, p) => {
          acc[p.problema] = (acc[p.problema] || 0) + 1;
          return acc;
        }, {}),
      ).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([problema, vezes]) => ({ problema, vezes })),
      imoveis: comProblema
        .sort((a, b) =>
          b.problemas.filter((p) => p.gravidade === "alta").length -
          a.problemas.filter((p) => p.gravidade === "alta").length)
        .slice(0, 60)
        .map((e) => ({
          id: e.id,
          titulo: e.titulo,
          local: e.local,
          preco: e.precoTexto,
          problemas: e.problemas,
          campos_incertos: e.camposIncertos,
        })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

propertiesRouter.get("/api/properties/:slug", publicReadLimiter, async (req, res) => {
  try {
    if (!isValidPublicPropertySlug(req.params.slug)) {
      return res.status(400).json({ error: "Slug de imóvel inválido" });
    }

    // Landing pública — allowlist explícita do corretor embutido: o resto de
    // imf_brokers tem segredos (reset_token, uazapi_instance_token,
    // asaas_credit_card_token, is_admin), que um select('*') vazava
    // pra qualquer um que acessasse um slug de imóvel.
    const { data, error } = await supabase
      .from('imf_properties')
      .select('*, brokers:imf_brokers(name, phone, broker_address)')
      .eq('slug', req.params.slug)
      .single();

    if (error?.code === 'PGRST116') return res.status(404).json({ error: "Imóvel não encontrado" });
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Imóvel não encontrado" });

    let imageUrlStr = data.image_url;
    let imagesArray: string[] = [];
    try {
      if (imageUrlStr && imageUrlStr.startsWith('[')) {
         imagesArray = JSON.parse(imageUrlStr);
         imageUrlStr = imagesArray[0] || '';
      } else if (imageUrlStr) {
         imagesArray = [imageUrlStr];
      }
    } catch(e) {
       imagesArray = imageUrlStr ? [imageUrlStr] : [];
    }
    data.imageUrl = imageUrlStr;
    data.images = imagesArray;

    // Parse campos estruturados embutidos na descrição
    const SEPARATOR = '---DETALHES-GERADOS---';
    let cleanDescription = data.description || '';
    let details: Record<string, any> = {};
    if (cleanDescription.includes(SEPARATOR)) {
      const parts = cleanDescription.split(SEPARATOR);
      cleanDescription = parts[0].trim();
      try { details = JSON.parse(parts[1].trim()); } catch { /* ignora */ }
    }
    data.description = cleanDescription;
    data.details = details;

    res.json(data);
  } catch (err: any) {
    console.error("Erro GET /api/properties/:slug:", {
      code: err?.code || "UNKNOWN",
      name: err?.name || "Error",
    });
    res.status(500).json({ error: "Não foi possível carregar o imóvel" });
  }
});

/**
 * Remove um imóvel do sistema permanentemente.
 */
propertiesRouter.delete("/api/properties/:id", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const query = supabase.from('imf_properties').delete().eq('id', req.params.id).eq('broker_id', brokerId);
    if (!(await isBrokerOwner(userId, brokerId))) query.eq('owner_user_id', userId);

    const { data, error } = await query.select('id');
    if (error) throw error;
    if (!data || data.length === 0) return res.status(403).json({ error: 'Acesso negado.' });
    invalidateBrokerCatalog(brokerId);
    res.status(200).json({ success: true });
  } catch (err: any) {
    console.error("Erro DELETE /api/properties:", err);
    res.status(500).json({ error: err.message });
  }
});

// Atualiza o status de um imóvel (disponivel / vendido / alugado)
propertiesRouter.patch("/api/properties/:id/status", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const { status } = req.body;
    if (!status) return res.status(400).json({ error: "Status é obrigatório." });

    const query = supabase.from('imf_properties').update({ status }).eq('id', req.params.id).eq('broker_id', brokerId);
    if (!(await isBrokerOwner(userId, brokerId))) query.eq('owner_user_id', userId);

    const { data, error } = await query.select().maybeSingle();

    if (error) throw error;
    if (!data) return res.status(403).json({ error: 'Acesso negado.' });
    invalidateBrokerCatalog(brokerId);
    res.json(data);
  } catch (err: any) {
    console.error("Erro PATCH /api/properties/:id/status:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- UPLOAD DE IMAGEM DE IMÓVEL ---
// Recebe UMA imagem base64, grava no Supabase Storage e devolve a URL
// pública (CDN). Substitui o antigo fluxo que trafegava arrays de base64
// pelo heap do Node e os gravava como TEXT no Postgres (causa do OOM).
propertiesRouter.post("/api/properties/upload-image", requireUser, async (req, res) => {
  const userId = (req as any).userId as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const { imageData } = req.body;
    if (!imageData || typeof imageData !== 'string') {
      return res.status(400).json({ error: "No image data" });
    }

    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Limite defensivo de 8MB por imagem já comprimida
    if (buffer.length > 8 * 1024 * 1024) {
      return res.status(413).json({ error: "Imagem muito grande (máx. 8MB)." });
    }

    const fileName = `prop-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;

    // Garante que o bucket existe (idempotente)
    await supabase.storage.createBucket('property-images', {
      public: true,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      fileSizeLimit: 8388608
    }).catch(() => {}); // ignora erro se bucket já existe

    const { error: uploadError } = await supabase.storage
      .from('property-images')
      .upload(fileName, buffer, { contentType: 'image/jpeg', upsert: true });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage
      .from('property-images')
      .getPublicUrl(fileName);

    res.json({ url: publicUrl });
  } catch (err: any) {
    console.error("Erro upload imagem imóvel:", err);
    res.status(500).json({ error: err.message });
  }
});
