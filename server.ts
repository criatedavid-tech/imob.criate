import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- CONFIGURAÇÃO INICIAL E AMBIENTE ---
// Carrega o .env (se existir), sobrescrevendo vars do ambiente se necessário
dotenv.config({ override: true });

// Fallback manual para as chaves do .env.example (Padrão do Sistema)
const FALLBACK_URL = "https://umvbrahsqvqeondwtikm.supabase.co";
const FALLBACK_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtdmJyYWhzcXZxZW9uZHd0aWttIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMjE5NDkxOSwiZXhwIjoyMDQ3NzcwOTE5fQ.slT50A_aa1rmo3fNX8eP7qZeHEPSDcCGGPXrB8GcfhQ";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // --- INTEGRAÇÃO COM SUPABASE ---
  const supabaseUrl = FALLBACK_URL;
  const supabaseKey = FALLBACK_KEY;
  
  // Cliente Supabase para operações no banco de dados e autenticação
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    }
  });

  // --- ROTAS DE AUTENTICAÇÃO (AUTH) ---
  /**
   * Realiza o cadastro de um novo usuário (corretor) no sistema.
   * Cria também um perfil inicial na tabela 'brokers'.
   */
  app.post("/api/auth/signup", async (req, res) => {
    try {
      const authClient = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { email, password, name, phone } = req.body;
      const { data, error } = await authClient.auth.signUp({ email, password });
      
      if (error) throw error;
      if (data.user) {
        // Create initial broker profile
        const { error: profileError } = await supabase.from('brokers').insert([
          { 
            user_id: data.user.id, 
            name: name || '', 
            phone: phone || '',
            ai_name: 'Minha Assistente IA',
            broker_address: ''
          }
        ]);
        if (profileError) console.error("Error creating profile:", profileError);
      }

      res.json({ user: data.user, session: data.session });
    } catch (err: any) {
      console.error("Auth Signup Error:", err);
      res.status(400).json({ error: err.message });
    }
  });

  /**
   * Realiza o login de um usuário existente.
   */
  app.post("/api/auth/login", async (req, res) => {
    try {
      const authClient = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { email, password } = req.body;
      const { data, error } = await authClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      res.json({ user: data.user, session: data.session });
    } catch (err: any) {
      console.error("Auth Login Error:", err);
      res.status(401).json({ error: err.message });
    }
  });

  // --- ROTAS DE CONFIGURAÇÃO DO CORRETOR ---
  /**
   * Obtém as informações do perfil do corretor logado.
   */
  app.get("/api/brokers/me", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Missing authorization" });
    
    try {
      const userId = req.headers['x-user-id'] as string; 
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(404).json({ error: "Broker profile could not be found or created" });

      const { data, error } = await supabase.from('brokers').select('*').eq('id', brokerId).single();
      if (error) throw error;
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Atualiza as configurações e informações do perfil do corretor.
   */
  app.post("/api/brokers/settings", async (req, res) => {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(404).json({ error: "Broker profile could not be found" });

      const settings = req.body;
      const { data, error } = await supabase.from('brokers').update({
        ...settings,
        updated_at: new Date()
      }).eq('id', brokerId).select().single();
      
      if (error) throw error;
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Helper to ensure broker exists
  async function getBrokerId(userId: string) {
    if (!userId) return null;
    try {
      const { data: brokers, error } = await supabase.from('brokers').select('id').eq('user_id', userId).order('created_at', { ascending: true }).limit(1);
      
      if (error) {
        console.error("Error fetching broker:", error);
        return null;
      }

      if (!brokers || brokers.length === 0) {
        console.log("Broker profile not found for user, creating one...");
        // Fallback: fetch user info from auth to get name/email if possible, or use defaults
        // Note: admin.getUserById might not work with standard key, but we try
        const { data: userData } = await supabase.auth.admin.getUserById(userId).catch(() => ({ data: { user: null } }));
        const user = userData?.user;
        
        const { data: newBroker, error: createError } = await supabase.from('brokers').insert([
          { 
            user_id: userId,
            name: user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Corretor',
            phone: '',
            ai_name: 'Minha Assistente IA',
            broker_address: ''
          }
        ]).select().single();
        
        if (createError) {
          console.error("Error creating broker profile on the fly:", createError);
          return null;
        }
        return newBroker.id;
      }
      
      return brokers[0].id;
    } catch (err) {
      console.error("error in getBrokerId:", err);
      return null;
    }
  }

  // --- UPLOAD DE FOTO DO CORRETOR ---
  app.post("/api/brokers/upload-photo", async (req, res) => {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
      const { imageData } = req.body;
      if (!imageData) return res.status(400).json({ error: "No image data" });

      const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const fileName = `broker-${userId}.jpg`;

      // Garante que o bucket existe
      await supabase.storage.createBucket('broker-photos', {
        public: true,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        fileSizeLimit: 5242880
      }).catch(() => {}); // ignora erro se bucket já existe

      const { error: uploadError } = await supabase.storage
        .from('broker-photos')
        .upload(fileName, buffer, { contentType: 'image/jpeg', upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('broker-photos')
        .getPublicUrl(fileName);

      res.json({ url: publicUrl });
    } catch (err: any) {
      console.error("Erro upload foto corretor:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // --- ROTAS DE INTELIGÊNCIA ARTIFICIAL (GEMINI) ---
  /**
   * Rota para aprimorar textos de descrições de imóveis.
   * Utiliza a API do Google Gemini para reescrever o texto com linguagem premium.
   */
  app.post("/api/ai/enhance-text", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text) {
        return res.status(400).json({ error: "Nenhum texto fornecido para aprimoramento." });
      }
      
      // Obtém a chave de API do ambiente
      const apiKey = process.env.GEMINI_API_KEY;
      
      // Validação básica da presença da chave
      if (!apiKey || apiKey === "undefined" || apiKey.length < 10) {
        console.error("ERRO: GEMINI_API_KEY não configurada ou inválida no servidor.");
        return res.status(500).json({ 
          error: "A funcionalidade de IA não está configurada corretamente (Chave de API ausente)." 
        });
      }
      
      // Inicialização do cliente GoogleGenAI
      const ai = new GoogleGenAI({ apiKey });
      
      // Chamada para geração de conteúdo com instrução de sistema
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        config: {
          systemInstruction: "Você é um especialista em redação imobiliária de alto padrão.\nReescreva a descrição abaixo com linguagem sofisticada, clara e atrativa,\nadequada para apresentação de residências premium.\nMantenha as informações originais, melhore a estrutura, o vocabulário\ne a formatação. Responda apenas com o texto melhorado, sem explicações adicionais."
        },
        contents: text,
      });
      
      // Retorna o texto sugerido pela IA
      res.json({ suggestedText: response.text });
    } catch (error: any) {
      // Log detalhado do erro para depuração no servidor
      console.error("Erro na API da IA (Gemini):", error);
      
      // Tratamento de mensagens de erro amigáveis
      let errorMsg = "Não foi possível gerar a sugestão no momento.";
      if (error.message?.includes("API key not valid")) {
        errorMsg = "Erro de autenticação com a API da IA. Verifique a configuração da chave.";
      } else if (error.message?.includes("high demand") || error.message?.includes("429") || error.message?.includes("quota")) {
        errorMsg = "O sistema atingiu o limite de uso temporário da IA (Cota). Por favor, aguarde 1 minuto e tente novamente.";
      }
      
      res.status(500).json({ error: errorMsg });
    }
  });

  // --- ROTAS DE PROPRIEDADES (IMÓVEIS) ---
  /**
   * Lista todos os imóveis associados ao usuário logado.
   */
  app.get("/api/properties", async (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const query = supabase.from('properties').select('*');
      
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
        let imageUrlStr = p.image_url;
        let imagesArray = [];
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

        return {
          ...p,
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

  app.post("/api/properties", async (req, res) => {
    try {
      let property = req.body;
      console.log("POST /api/properties payload:", property);
      
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
      const origin = req.headers.origin || req.headers.referer || "https://elev-imoveis.com";
      // Remove barra final se existir para garantir formatação limpa
      const cleanOrigin = origin.endsWith('/') ? origin.slice(0, -1) : origin;
      property.link = `${cleanOrigin}/p/${property.slug}`;

      // Link to broker
      const userId = req.headers['x-user-id'] as string;
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
        'link' // <--- Nova coluna para o link da landing page
      ];

      const filteredProperty = Object.keys(property)
        .filter(key => validColumns.includes(key))
        .reduce((obj: any, key) => {
          obj[key] = property[key];
          return obj;
        }, {});

      const { data, error } = await supabase.from('properties').upsert(filteredProperty).select().single();
      
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

  // NOVO: implementado em 30/04/2026 - não altera legado
  app.get("/api/dashboard/metrics", async (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.json({ totalProperties: 0, activeLeads: 0, scheduledVisits: 0 });

      // Count properties
      const { count: propertyCount, error: propError } = await supabase
        .from('properties')
        .select('*', { count: 'exact', head: true })
        .eq('broker_id', brokerId);

      if (propError) throw propError;

      // Count leads for these properties
      // First get property IDs
      const { data: propIds, error: idsError } = await supabase
        .from('properties')
        .select('id')
        .eq('broker_id', brokerId);

      if (idsError) throw idsError;

      const ids = (propIds || []).map(p => p.id);
      
      let activeLeads = 0;
      if (ids.length > 0) {
        const { count: leadsCount, error: leadsError } = await supabase
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .in('property_id', ids)
          .neq('status', 'archived'); // Assuming 'archived' as inactive

        if (leadsError) {
          console.error("Error fetching leads count:", leadsError);
        } else {
          activeLeads = leadsCount || 0;
        }
      }

      res.json({
        totalProperties: propertyCount || 0,
        activeLeads: activeLeads,
        scheduledVisits: 0 // Default fallback as per requirement
      });
    } catch (err: any) {
      console.error("Erro GET /api/dashboard/metrics:", err);
      res.json({ totalProperties: 0, activeLeads: 0, scheduledVisits: 0 }); // Fallback
    }
  });

  // NOVO: implementado em 30/04/2026 - não altera legado
  app.get("/api/leads/recent", async (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.json([]);

      // Get property IDs first to filter leads
      const { data: propIds, error: idsError } = await supabase
        .from('properties')
        .select('id, title')
        .eq('broker_id', brokerId);

      if (idsError) throw idsError;

      const propertiesMap = new Map((propIds || []).map(p => [p.id, p.title]));
      const ids = Array.from(propertiesMap.keys());
      
      if (ids.length === 0) return res.json([]);

      const { data: leads, error: leadsError } = await supabase
        .from('leads')
        .select('*')
        .in('property_id', ids)
        .order('created_at', { ascending: false })
        .limit(5);

      if (leadsError) throw leadsError;

      const formattedLeads = (leads || []).map(l => ({
        id: l.id,
        name: l.name,
        property: propertiesMap.get(l.property_id) || "Imóvel desconhecido",
        time: l.created_at,
        status: l.status
      }));

      res.json(formattedLeads);
    } catch (err: any) {
      console.error("Erro GET /api/leads/recent:", err);
      res.json([]); // Fallback
    }
  });

  app.get("/api/properties/health", async (req, res) => {
    try {
      const { data, error } = await supabase.from('properties').select('id').limit(1);
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

  app.get("/api/properties/:slug", async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('properties')
        .select('*, brokers(*)')
        .eq('slug', req.params.slug)
        .single();
      
      if (error) throw error;
      if (!data) return res.status(404).json({ error: "Not found" });
      
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
      
      res.json(data);
    } catch (err: any) {
      console.error("Erro GET /api/properties/:slug:", err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Remove um imóvel do sistema permanentemente.
   */
  app.delete("/api/properties/:id", async (req, res) => {
    try {
      const { error } = await supabase.from('properties').delete().eq('id', req.params.id);
      if (error) throw error;
      res.status(200).json({ success: true });
    } catch (err: any) {
      console.error("Erro DELETE /api/properties:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // --- FLUXO DE CAPTURA DE LEADS (30/04/2026) ---
  /**
   * Endpoint aprimorado para salvar leads e disparar integrações automáticas.
   */
  app.post("/api/leads", async (req, res) => {
    try {
      const { property_id, name, phone, email, status, notes } = req.body;

      // 1. Validação básica
      if (!name || !phone || !property_id) {
        return res.status(400).json({ error: "Nome, telefone e ID do imóvel são obrigatórios." });
      }

      // 2. Inserir na tabela leads
      const { data: lead, error: insertError } = await supabase.from('leads').insert([
        {
          property_id,
          name,
          phone,
          email: email || '',
          status: status || 'new',
          notes: notes || 'Lead via Landing Page',
          created_at: new Date()
        }
      ]).select().single();

      if (insertError) throw insertError;

      // 3. Roteamento (Chatbot Webhook ou E-mail)
      const webhookUrl = process.env.CHATBOT_WEBHOOK_URL;
      let integrationStatus = "none";

      if (webhookUrl) {
        // Envio assíncrono para o Webhook (Fire and Forget)
        fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lead_id: lead.id,
            name,
            phone,
            property_id,
            origin: 'Landing Page',
            timestamp: new Date().toISOString()
          })
        }).catch(err => console.error("Erro ao disparar Webhook:", err));
        integrationStatus = "chatbot";
      } else {
        // Simulação de disparo de e-mail (Log de console como fallback do sistema)
        console.log(`[E-MAIL SIMULADO] Para: corretor do imóvel ${property_id}. Assunto: Novo lead - ${name}`);
        integrationStatus = "email";
      }

      // 4. Log (Opcional - usando console para não criar novas tabelas se não existirem)
      console.log(`// FLUXO ENVIAR LEAD 30/04/2026: Lead ID ${lead.id} enviado. Chatbot: ${webhookUrl ? 'sim' : 'nao'}`);

      res.status(201).json({ ...lead, integrationStatus });
    } catch (err: any) {
      console.error("Erro no fluxo de envio de lead:", err);
      res.status(500).json({ error: "Falha ao processar contato. Por favor, use o WhatsApp." });
    }
  });

  // NOVO LANDING 30/04/2026 - Endpoint para buscar agenda
  app.get("/api/agenda", async (req, res) => {
    try {
      // Como a tabela 'agenda' pode não existir ou ter nome diferente no sistema real do usuário
      // tentamos buscar da tabela 'agenda'. Se der erro, retornamos lista vazia conforme requisito fallback.
      const { data, error } = await supabase.from('agenda').select('*');
      
      if (error) {
        console.log("Aviso: Tabela 'agenda' não encontrada. Usando fallback de lista vazia.");
        return res.json([]);
      }
      
      res.json(data || []);
    } catch (err) {
      res.json([]);
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
