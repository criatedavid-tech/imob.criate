import express from "express";
import { supabase } from "../supabase";
import { requireUser, optionalUser, getBrokerId } from "../middleware/auth";
import { APP_URL } from "../config";

export const propertiesRouter = express.Router();

// --- ROTAS DE PROPRIEDADES (IMÓVEIS) ---
/**
 * Lista todos os imóveis associados ao usuário logado.
 */
propertiesRouter.get("/api/properties", optionalUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const query = supabase.from('imf_properties').select('*');

    if (userId) {
      const brokerId = await getBrokerId(userId);
      if (brokerId) {
        query.eq('broker_id', brokerId);
      } else {
        // If no broker found/created, maybe show nothing or all?
        // The user expects to see THEIR houses.
        query.eq('broker_id', '00000000-0000-0000-0000-000000000000'); // Force empty if no broker
      }
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
     */
    const origin = req.headers.origin || req.headers.referer || APP_URL;
    // Remove barra final se existir para garantir formatação limpa
    const cleanOrigin = origin.endsWith('/') ? origin.slice(0, -1) : origin;
    property.link = `${cleanOrigin}/p/${property.slug}`;

    // Link to broker
    const userId = (req as any).userId as string;
    if (userId) {
      const brokerId = await getBrokerId(userId);
      if (brokerId) {
        property.broker_id = brokerId;
      } else {
        console.error("Could not associate property with a broker (no broker found or created)");
        return res.status(403).json({ error: "Sua conta não possui um perfil de corretor para cadastrar imóveis. Tente fazer login novamente." });
      }
    } else {
      return res.status(401).json({ error: "O usuário não está autenticado e não pode salvar o imóvel." });
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
    res.json({
      database: "ERROR",
      supabase_api: "ERROR",
      db_error: err.message || JSON.stringify(err),
      full_error: err,
      message: "Node.js Backend via Supabase (Error)"
    });
  }
});

propertiesRouter.get("/api/properties/:slug", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('imf_properties')
      .select('*, imf_brokers(*)')
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
    console.error("Erro GET /api/properties/:slug:", err);
    res.status(500).json({ error: err.message });
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

    const { error } = await supabase.from('imf_properties').delete()
      .eq('id', req.params.id)
      .eq('broker_id', brokerId);
    if (error) throw error;
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

    const { data, error } = await supabase
      .from('imf_properties')
      .update({ status })
      .eq('id', req.params.id)
      .eq('broker_id', brokerId)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(403).json({ error: 'Acesso negado.' });
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
