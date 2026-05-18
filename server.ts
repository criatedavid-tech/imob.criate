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
const FALLBACK_KEY = "SUPABASE_SERVICE_ROLE_KEY_REDACTED";

// ─── VARIÁVEIS DE AMBIENTE EXTERNAS ───────────────────────────────────────────
const APP_URL             = process.env.APP_URL             || "http://localhost:3000";
const ASAAS_API_KEY       = process.env.ASAAS_API_KEY       || "";
const ASAAS_BASE_URL      = process.env.ASAAS_ENV === 'production'
  ? 'https://api.asaas.com/v3'
  : 'https://sandbox.asaas.com/api/v3';
const ZPRO_ADMIN_URL      = process.env.ZPRO_ADMIN_URL      || "";
const ZPRO_ADMIN_TOKEN    = process.env.ZPRO_ADMIN_TOKEN    || "";
const UAZAPI_HOST         = process.env.UAZAPI_HOST         || "https://criate.uazapi.com";
const UAZAPI_TOKEN        = process.env.UAZAPI_TOKEN        || "d0R4HE6Vt0Y3eeej5W0NYTfz9rQlSjH85w61fNeZXcNxJNOEwi";
const PROVISIONING_WEBHOOK_URL = process.env.PROVISIONING_WEBHOOK_URL
  || "https://212hook.criate.online/webhook/f19c91c4-b826-4150-af8d-151200e619f0";
const N8N_WEBHOOK_URL     = process.env.N8N_WEBHOOK_URL
  || "https://212hook.criate.online/webhook/edc20beb-c9c1-46c3-bbef-8fa81538cbb3";
const SUBSCRIPTION_VALUE  = Number(process.env.SUBSCRIPTION_VALUE || "5.00");
// UAZAPI_URL e UAZAPI_TOKEN não são passados via código — configurados direto no painel Z-PRO
// E-mail de boas-vindas é enviado manualmente por um responsável humano

// Normaliza telefone BR para o formato exigido pelo WhatsApp/Z-PRO:
// DDI 55 + DDD (2) + 8 dígitos, sem o nono dígito.
// Ex.: "(62)99159-2150" -> "556291592150"
function normalizePhoneBR(raw: string): string {
  let d = (raw || '').replace(/\D/g, '');
  if (!d) return '';
  // Remove DDI 55 se já presente (12+ dígitos = 55 + DDD + 8/9)
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  const ddd = d.slice(0, 2);
  let num = d.slice(2);
  // Remove o nono dígito do celular (9 dígitos começando com 9 -> 8 dígitos)
  if (num.length === 9 && num.startsWith('9')) num = num.slice(1);
  return `55${ddd}${num}`;
}

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
      const { email, password, name, phone } = req.body;
      if (!email || !password || !name) {
        return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios.' });
      }

      // Verifica se já existe conta com este e-mail
      const { data: existing } = await supabase.from('brokers').select('id').eq('email', email.toLowerCase().trim()).maybeSingle();
      if (existing) {
        return res.status(400).json({ error: 'Este e-mail já possui uma conta. Faça login ou recupere sua senha.' });
      }

      const authClient = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await authClient.auth.signUp({ email: email.toLowerCase().trim(), password });
      if (error) throw error;

      if (data.user) {
        await supabase.auth.admin.updateUserById(data.user.id, { email_confirm: true }).catch(e => console.error("Auto-confirm error:", e));

        const { error: profileError } = await supabase.from('brokers').insert([{
          user_id: data.user.id,
          name: name.trim(),
          phone: normalizePhoneBR(phone),
          email: email.toLowerCase().trim(),
          ai_name: 'Minha Assistente IA',
          broker_address: '',
          status: 'pendente'
        }]);
        if (profileError) console.error("Error creating profile:", profileError);

        const authClient2 = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
        const { data: loginData } = await authClient2.auth.signInWithPassword({ email: email.toLowerCase().trim(), password });
        return res.json({ user: loginData?.user || data.user, session: loginData?.session || data.session });
      }

      res.json({ user: data.user, session: data.session });
    } catch (err: any) {
      console.error("Auth Signup Error:", err);
      const msg = err.message?.includes('already registered')
        ? 'Este e-mail já possui uma conta. Faça login ou recupere sua senha.'
        : err.message;
      res.status(400).json({ error: msg });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });

      const authClient = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await authClient.auth.signInWithPassword({ email: email.toLowerCase().trim(), password });
      if (error) {
        const msg = error.message?.toLowerCase().includes('invalid')
          ? 'E-mail ou senha incorretos.'
          : error.message;
        return res.status(401).json({ error: msg });
      }
      res.json({ user: data.user, session: data.session });
    } catch (err: any) {
      console.error("Auth Login Error:", err);
      res.status(401).json({ error: err.message });
    }
  });

  // Envia e-mail de recuperação de senha (via Supabase)
  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'E-mail obrigatório.' });

      const { error } = await supabase.auth.resetPasswordForEmail(email.toLowerCase().trim(), {
        redirectTo: `${APP_URL}/reset-password`
      });
      if (error) throw error;

      res.json({ message: 'Se o e-mail estiver cadastrado, você receberá as instruções em instantes.' });
    } catch (err: any) {
      console.error("Forgot password error:", err);
      // Sempre retorna sucesso para não revelar se o e-mail existe
      res.json({ message: 'Se o e-mail estiver cadastrado, você receberá as instruções em instantes.' });
    }
  });

  // Atualiza a senha usando o token do e-mail de recuperação
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { accessToken, newPassword } = req.body;
      if (!accessToken || !newPassword) return res.status(400).json({ error: 'Token e nova senha são obrigatórios.' });
      if (newPassword.length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });

      const userClient = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${accessToken}` } }
      });
      const { error } = await userClient.auth.updateUser({ password: newPassword });
      if (error) throw error;

      res.json({ message: 'Senha atualizada com sucesso.' });
    } catch (err: any) {
      console.error("Reset password error:", err);
      res.status(400).json({ error: 'Link expirado ou inválido. Solicite uma nova recuperação de senha.' });
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
      if (settings.phone !== undefined) settings.phone = normalizePhoneBR(settings.phone);
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

  // ─────────────────────────────────────────────────────────────────────────
  // CORRETORA (imobiliária) — vínculo N:1 (broker → corretora)
  // ─────────────────────────────────────────────────────────────────────────

  // Retorna a corretora vinculada ao corretor logado
  app.get("/api/corretora", async (req, res) => {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(404).json({ error: "Perfil não encontrado." });

      const { data: broker } = await supabase.from('brokers')
        .select('corretora_id').eq('id', brokerId).single();

      if (!broker?.corretora_id) return res.json({ corretora: null });

      const { data: corretora } = await supabase.from('corretoras')
        .select('*').eq('id', broker.corretora_id).single();

      res.json({ corretora, isOwner: corretora?.owner_broker_id === brokerId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Cria/atualiza a corretora e vincula o corretor logado (upsert por CNPJ)
  app.post("/api/corretora", async (req, res) => {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(404).json({ error: "Perfil não encontrado." });

      const { razao_social, cnpj, creci_empresa, endereco, telefone, email } = req.body;
      if (!razao_social || !cnpj) {
        return res.status(400).json({ error: "Razão social e CNPJ são obrigatórios." });
      }
      const cnpjClean = String(cnpj).replace(/\D/g, '');

      // Já existe corretora com este CNPJ? vincula a ela; senão cria
      const { data: existing } = await supabase.from('corretoras')
        .select('*').eq('cnpj', cnpjClean).maybeSingle();

      let corretora = existing;
      if (existing) {
        // Só o owner pode editar os dados da corretora existente
        if (existing.owner_broker_id === brokerId) {
          const { data: upd } = await supabase.from('corretoras').update({
            razao_social, creci_empresa: creci_empresa || null,
            endereco: endereco || null, telefone: telefone ? normalizePhoneBR(telefone) : null,
            email: email || null, updated_at: new Date().toISOString()
          }).eq('id', existing.id).select().single();
          corretora = upd || existing;
        }
      } else {
        const { data: created, error: cErr } = await supabase.from('corretoras').insert({
          razao_social, cnpj: cnpjClean, creci_empresa: creci_empresa || null,
          endereco: endereco || null, telefone: telefone ? normalizePhoneBR(telefone) : null,
          email: email || null, owner_broker_id: brokerId
        }).select().single();
        if (cErr) throw cErr;
        corretora = created;
      }

      // Vincula o corretor logado à corretora
      await supabase.from('brokers')
        .update({ corretora_id: corretora.id, updated_at: new Date() })
        .eq('id', brokerId);

      res.json({ corretora, isOwner: corretora.owner_broker_id === brokerId });
    } catch (err: any) {
      console.error("Erro POST /api/corretora:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Lista os corretores vinculados à corretora (apenas o owner/admin da corretora vê)
  app.get("/api/corretora/brokers", async (req, res) => {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(404).json({ error: "Perfil não encontrado." });

      const { data: broker } = await supabase.from('brokers')
        .select('corretora_id').eq('id', brokerId).single();
      if (!broker?.corretora_id) return res.json({ brokers: [] });

      const { data: corretora } = await supabase.from('corretoras')
        .select('owner_broker_id').eq('id', broker.corretora_id).single();
      if (corretora?.owner_broker_id !== brokerId) {
        return res.status(403).json({ error: "Apenas o administrador da corretora pode ver os corretores vinculados." });
      }

      const { data: brokers } = await supabase.from('brokers')
        .select('id, name, email, phone, status, created_at')
        .eq('corretora_id', broker.corretora_id)
        .order('created_at', { ascending: true });

      res.json({ brokers: brokers || [] });
    } catch (err: any) {
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
        model: "gemini-2.0-flash-lite",
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

  app.post("/api/properties", async (req, res) => {
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
        'link',
        'status'
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
      let scheduledVisits = 0;

      if (ids.length > 0) {
        const { count: leadsCount } = await supabase
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .in('property_id', ids)
          .neq('status', 'archived');
        activeLeads = leadsCount || 0;

        const { count: visitsCount } = await supabase
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .in('property_id', ids)
          .in('status', ['visita_agendada', 'agendado']);
        scheduledVisits = visitsCount || 0;
      }

      res.json({
        totalProperties: propertyCount || 0,
        activeLeads,
        scheduledVisits
      });
    } catch (err: any) {
      console.error("Erro GET /api/dashboard/metrics:", err);
      res.json({ totalProperties: 0, activeLeads: 0, scheduledVisits: 0 }); // Fallback
    }
  });

  app.get("/api/dashboard/charts", async (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.json([]);

      const { data: propIds } = await supabase
        .from('properties')
        .select('id')
        .eq('broker_id', brokerId);

      const ids = (propIds || []).map((p: any) => p.id);

      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
      sixMonthsAgo.setDate(1);
      sixMonthsAgo.setHours(0, 0, 0, 0);

      let leads: any[] = [];
      if (ids.length > 0) {
        const { data } = await supabase
          .from('leads')
          .select('created_at')
          .in('property_id', ids)
          .gte('created_at', sixMonthsAgo.toISOString());
        leads = data || [];
      }

      const counts: Record<string, number> = {};
      const now = new Date();
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        counts[key] = 0;
      }
      for (const lead of leads) {
        const d = new Date(lead.created_at);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (key in counts) counts[key]++;
      }

      const result = Object.entries(counts).map(([key, value]) => {
        const [year, month] = key.split('-');
        const name = new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(new Date(parseInt(year), parseInt(month) - 1, 1));
        return { name: name.replace('.', ''), value };
      });

      res.json(result);
    } catch (err: any) {
      console.error("Erro GET /api/dashboard/charts:", err);
      res.json([]);
    }
  });

  app.get("/api/leads/recent", async (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.json([]);

      const { data: propIds, error: idsError } = await supabase
        .from('properties')
        .select('id, title')
        .eq('broker_id', brokerId);

      if (idsError) throw idsError;

      const propertiesMap = new Map((propIds || []).map((p: any) => [p.id, p.title]));
      const ids = Array.from(propertiesMap.keys());

      let leads: any[] = [];
      if (ids.length > 0) {
        const { data, error } = await supabase
          .from('leads')
          .select('*')
          .in('property_id', ids)
          .order('created_at', { ascending: false })
          .limit(5);
        if (error) throw error;
        leads = data || [];
      }

      const formattedLeads = leads.map((l: any) => ({
        id: l.id,
        name: l.name || l.client_name || 'Sem nome',
        property: propertiesMap.get(l.property_id) || 'Imóvel desconhecido',
        time: l.created_at,
        status: l.status
      }));

      res.json(formattedLeads);
    } catch (err: any) {
      console.error("Erro GET /api/leads/recent:", err);
      res.json([]);
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

  app.get("/api/agenda/visits", async (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.json([]);

      // Lê da tabela agenda (criada para o N8N gravar agendamentos)
      const { data: agendaVisits, error: agendaError } = await supabase
        .from('agenda')
        .select('*')
        .eq('broker_id', brokerId)
        .order('scheduled_at', { ascending: true });

      if (agendaError) throw agendaError;

      // Retrocompat: lê também de leads com status de visita agendada (dados antigos)
      const { data: propIds } = await supabase
        .from('properties')
        .select('id, title')
        .eq('broker_id', brokerId);

      const propertiesMap = new Map((propIds || []).map((p: any) => [p.id, p.title]));
      const ids = Array.from(propertiesMap.keys());

      let legacyVisits: any[] = [];
      if (ids.length > 0) {
        const { data } = await supabase
          .from('leads')
          .select('*')
          .in('property_id', ids)
          .in('status', ['visita_agendada', 'agendado'])
          .order('created_at', { ascending: false });
        legacyVisits = (data || []).map((l: any) => ({
          ...l,
          name: l.name || l.client_name || 'Sem nome',
          phone: l.phone || l.client_phone || '',
          scheduled_at: l.created_at,
          property: propertiesMap.get(l.property_id) || 'Imóvel desconhecido'
        }));
      }

      const agendaFormatted = (agendaVisits || []).map((a: any) => ({
        ...a,
        name: a.title || 'Sem nome',
        property: propertiesMap.get(a.property_id) || 'Imóvel desconhecido'
      }));

      res.json([...agendaFormatted, ...legacyVisits]);
    } catch (err: any) {
      console.error("Erro GET /api/agenda/visits:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/leads", async (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.json([]);

      const { data: propIds, error: idsError } = await supabase
        .from('properties')
        .select('id, title')
        .eq('broker_id', brokerId);

      if (idsError) throw idsError;

      const propertiesMap = new Map((propIds || []).map((p: any) => [p.id, p.title]));
      const ids = Array.from(propertiesMap.keys());

      let leads: any[] = [];
      if (ids.length > 0) {
        const { data, error } = await supabase
          .from('leads')
          .select('*')
          .in('property_id', ids)
          .order('created_at', { ascending: false });
        if (error) throw error;
        leads = data || [];
      }

      res.json(leads.map((l: any) => ({
        ...l,
        name: l.name || l.client_name || 'Sem nome',
        phone: l.phone || l.client_phone || '',
        property: propertiesMap.get(l.property_id) || 'Imóvel desconhecido'
      })));
    } catch (err: any) {
      console.error("Erro GET /api/leads:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Atualiza o status de um imóvel (disponivel / vendido / alugado)
  app.patch("/api/properties/:id/status", async (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { status } = req.body;
      if (!status) return res.status(400).json({ error: "Status é obrigatório." });

      const { data, error } = await supabase
        .from('properties')
        .update({ status })
        .eq('id', req.params.id)
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (err: any) {
      console.error("Erro PATCH /api/properties/:id/status:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Atualiza o status de um lead
  app.patch("/api/leads/:id/status", async (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { status } = req.body;
      if (!status) return res.status(400).json({ error: "Status é obrigatório." });

      const { data, error } = await supabase
        .from('leads')
        .update({ status })
        .eq('id', req.params.id)
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (err: any) {
      console.error("Erro PATCH /api/leads/:id/status:", err);
      res.status(500).json({ error: err.message });
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

  // ─────────────────────────────────────────────────────────────────────────
  // ASAAS — CHECKOUT E WEBHOOK
  // ─────────────────────────────────────────────────────────────────────────

  const asaasHeaders = () => ({
    'Content-Type': 'application/json',
    'access_token': ASAAS_API_KEY
  });

  // Cria cobrança no Asaas (cartão de crédito) e ativa o corretor imediatamente
  app.post("/api/checkout", async (req, res) => {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (!ASAAS_API_KEY) {
      return res.status(503).json({ error: "Pagamento ainda não configurado. Aguarde." });
    }

    const { cpfCnpj, cardHolder, cardNumber, expiryMonth, expiryYear, cvv } = req.body;
    if (!cpfCnpj || !cardHolder || !cardNumber || !expiryMonth || !expiryYear || !cvv) {
      return res.status(400).json({ error: "Dados do cartão incompletos." });
    }

    try {
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(404).json({ error: "Perfil não encontrado." });

      const { data: broker } = await supabase.from('brokers').select('*').eq('id', brokerId).single();
      if (!broker) return res.status(404).json({ error: "Corretor não encontrado." });

      // 1. Cria cliente no Asaas
      const customerResp = await fetch(`${ASAAS_BASE_URL}/customers`, {
        method: 'POST',
        headers: asaasHeaders(),
        body: JSON.stringify({
          name: broker.name || broker.email,
          cpfCnpj: cpfCnpj.replace(/\D/g, ''),
          email: broker.email,
          phone: (broker.phone || '').replace(/\D/g, '')
        })
      });

      const customerData = await customerResp.json();
      if (!customerResp.ok) {
        throw new Error(customerData.errors?.[0]?.description || 'Erro ao registrar cliente');
      }
      const customerId = customerData.id;

      // 2. Cria assinatura RECORRENTE mensal com cartão de crédito
      const nextDueDate = new Date().toISOString().split('T')[0];
      const subscriptionResp = await fetch(`${ASAAS_BASE_URL}/subscriptions`, {
        method: 'POST',
        headers: asaasHeaders(),
        body: JSON.stringify({
          customer: customerId,
          billingType: 'CREDIT_CARD',
          value: SUBSCRIPTION_VALUE,
          nextDueDate,
          cycle: 'MONTHLY',
          description: 'ImobiFlow - Assinatura Mensal',
          creditCard: {
            holderName: cardHolder,
            number: cardNumber.replace(/\s/g, ''),
            expiryMonth,
            expiryYear,
            ccv: cvv
          },
          creditCardHolderInfo: {
            name: cardHolder,
            email: broker.email,
            cpfCnpj: cpfCnpj.replace(/\D/g, ''),
            postalCode: '00000000',
            addressNumber: 'S/N',
            phone: (broker.phone || '').replace(/\D/g, '') || '00000000000'
          }
        })
      });

      const subscription = await subscriptionResp.json();
      if (!subscriptionResp.ok) {
        throw new Error(subscription.errors?.[0]?.description || subscription.message || 'Assinatura recusada');
      }

      // 3. Busca o primeiro payment gerado pela subscription
      const firstPaymentResp = await fetch(
        `${ASAAS_BASE_URL}/subscriptions/${subscription.id}/payments`,
        { method: 'GET', headers: asaasHeaders() }
      );
      const firstPaymentList = await firstPaymentResp.json();
      const firstPayment = firstPaymentList.data?.[0];

      if (!firstPayment) {
        throw new Error('Primeira cobrança da assinatura não foi gerada.');
      }
      if (firstPayment.status !== 'CONFIRMED' && firstPayment.status !== 'RECEIVED') {
        throw new Error('Pagamento não aprovado. Verifique os dados do cartão.');
      }

      // 4. Salva subscription_id no broker e ativa imediatamente
      await supabase.from('brokers')
        .update({ asaas_subscription_id: subscription.id })
        .eq('id', brokerId);

      await handleAsaasPaymentReceived({
        id: firstPayment.id,
        customerId,
        value: firstPayment.value,
        brokerId,
        subscriptionId: subscription.id
      });

      res.json({ success: true, paymentId: firstPayment.id, subscriptionId: subscription.id });
    } catch (err: any) {
      console.error("Erro no checkout Asaas:", err);
      res.status(400).json({ error: err.message });
    }
  });

  // Retorna status da assinatura do corretor
  app.get("/api/subscription", async (req, res) => {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(404).json({ error: "Perfil não encontrado." });

      let { data: broker } = await supabase.from('brokers')
        .select('status, plan, valid_until, grace_until, zpro_tenant_id, zpro_channel_id, zpro_qr_code')
        .eq('id', brokerId).single();

      // Enforcement lazy do grace period: se passou de grace_until e ainda está
      // 'ativo', suspende o acesso agora (cobre PAYMENT_OVERDUE sem cron job).
      if (broker?.status === 'ativo' && broker?.grace_until && new Date(broker.grace_until) < new Date()) {
        await supabase.from('brokers').update({ status: 'inativo' }).eq('id', brokerId);
        broker = { ...broker, status: 'inativo' };
      }

      const { data: lastSub } = await supabase.from('subscriptions')
        .select('*').eq('broker_id', brokerId)
        .order('created_at', { ascending: false }).limit(1).single();

      res.json({ broker, lastSubscription: lastSub });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Retorna status e QR Code do WhatsApp do corretor
  app.get("/api/whatsapp/status", async (req, res) => {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(404).json({ error: "Perfil não encontrado." });

      const { data: broker } = await supabase.from('brokers')
        .select('zpro_tenant_id, zpro_api_key, zpro_channel_id, zpro_qr_code, zpro_channel_name, status')
        .eq('id', brokerId).single();

      if (!broker?.zpro_channel_id) {
        return res.json({ connected: false, qr_code: null, message: "Canal WhatsApp ainda não criado." });
      }

      // Se Z-PRO estiver configurado, consulta status em tempo real
      if (ZPRO_ADMIN_URL && ZPRO_ADMIN_TOKEN && broker.zpro_api_key) {
        try {
          const apiHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${ZPRO_ADMIN_TOKEN}` };

          // Consulta status do canal — POST /v2/api/external/{apiId}/showChannelById
          const statusResp = await fetch(`${ZPRO_ADMIN_URL}/v2/api/external/${broker.zpro_api_key}/showChannelById`, {
            method: 'POST',
            headers: apiHeaders,
            body: JSON.stringify({ id: Number(broker.zpro_channel_id) })
          });
          const channelData = await statusResp.json();
          const connected = channelData.status === 'CONNECTED' || channelData.connected === true;

          if (connected) {
            return res.json({ connected: true, qr_code: null, channel_name: broker.zpro_channel_name });
          }

          // Não conectado: busca QR code atualizado — POST /v2/api/external/{apiId}/qrCodeSession
          const qrResp = await fetch(`${ZPRO_ADMIN_URL}/v2/api/external/${broker.zpro_api_key}/qrCodeSession`, {
            method: 'POST',
            headers: apiHeaders,
            body: JSON.stringify({ whatsappId: Number(broker.zpro_channel_id) })
          });
          const qrData = await qrResp.json();
          const freshQr = qrData.qrcode || qrData.qr_code || qrData.base64 || null;

          if (freshQr) {
            await supabase.from('brokers').update({ zpro_qr_code: freshQr }).eq('id', brokerId);
          }

          return res.json({ connected: false, qr_code: freshQr || broker.zpro_qr_code, channel_name: broker.zpro_channel_name });
        } catch {
          // fallback: retorna dados do banco
        }
      }

      res.json({ connected: false, qr_code: broker.zpro_qr_code, channel_name: broker.zpro_channel_name });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Webhook do Asaas — confirmação de pagamento, cancelamento
  app.post("/api/webhooks/asaas", async (req, res) => {
    const event = req.body;

    await supabase.from('webhook_logs').insert({
      source: 'asaas',
      event_type: event.event,
      payload: event,
      status: 'received'
    });

    if (event.event === 'PAYMENT_RECEIVED' || event.event === 'PAYMENT_CONFIRMED') {
      const p = event.payment;
      const { data: broker } = await supabase.from('brokers')
        .select('id, asaas_subscription_id').eq('asaas_customer_id', p.customer).single();
      if (broker) {
        await handleAsaasPaymentReceived({
          id: p.id,
          customerId: p.customer,
          value: p.value,
          brokerId: broker.id,
          subscriptionId: p.subscription || broker.asaas_subscription_id || undefined
        });
      }
    } else if (event.event === 'PAYMENT_OVERDUE') {
      // Inadimplência: NÃO bloqueia na hora — concede grace period de 3 dias.
      // A suspensão efetiva é aplicada lazy em GET /api/subscription quando grace_until expira.
      const p = event.payment;
      const graceUntil = new Date();
      graceUntil.setDate(graceUntil.getDate() + 3);
      await supabase.from('brokers')
        .update({ grace_until: graceUntil.toISOString() })
        .eq('asaas_customer_id', p.customer);
      await supabase.from('subscriptions').update({ status: 'overdue' }).eq('asaas_payment_id', p.id);
    } else if (event.event === 'PAYMENT_DELETED') {
      const p = event.payment;
      await supabase.from('brokers').update({ status: 'inativo' }).eq('asaas_customer_id', p.customer);
      await supabase.from('subscriptions').update({ status: 'cancelled' }).eq('asaas_payment_id', p.id);
    } else if (
      event.event === 'SUBSCRIPTION_DELETED' ||
      event.event === 'SUBSCRIPTION_INACTIVATED' ||
      event.event === 'SUBSCRIPTION_CANCELED'
    ) {
      // Assinatura cancelada → desativa o corretor e marca o tenant Z-PRO como desativado.
      const sub = event.subscription || event.payment;
      const subId = sub?.id || sub?.subscription;
      if (subId) {
        await supabase.from('brokers')
          .update({ status: 'inativo', provisioning_status: 'disabled' })
          .eq('asaas_subscription_id', subId);
      }
    }

    res.json({ received: true });
  });

  // Endpoint de teste — simula ativação sem Asaas (apenas dev)
  app.post("/api/webhooks/asaas/test", async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: "Não disponível em produção." });
    }
    const { broker_id } = req.body;
    if (!broker_id) return res.status(400).json({ error: "broker_id obrigatório." });

    await handleAsaasPaymentReceived({
      id: `pay_test_${Date.now()}`,
      customerId: `cus_test_${Date.now()}`,
      value: 1.00,
      brokerId: broker_id
    });
    res.json({ success: true, message: "Corretor ativado via teste." });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PAINEL ADMIN
  // ─────────────────────────────────────────────────────────────────────────

  async function requireAdmin(req: any, res: any): Promise<boolean> {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return false; }
    const { data } = await supabase.from('brokers').select('is_admin').eq('user_id', userId).single();
    if (!data?.is_admin) { res.status(403).json({ error: "Acesso negado" }); return false; }
    return true;
  }

  // Lista todos os corretores com dados de assinatura
  app.get("/api/admin/brokers", async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    try {
      const { data, error } = await supabase
        .from('brokers')
        .select('id, name, email, phone, status, plan, valid_until, created_at, is_admin, asaas_customer_id, zpro_tenant_id')
        .order('created_at', { ascending: false });
      if (error) throw error;
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Métricas globais da plataforma
  app.get("/api/admin/metrics", async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    try {
      const [brokersRes, propertiesRes, leadsRes, activeRes, revenueRes] = await Promise.all([
        supabase.from('brokers').select('id', { count: 'exact', head: true }),
        supabase.from('properties').select('id', { count: 'exact', head: true }),
        supabase.from('leads').select('id', { count: 'exact', head: true }),
        supabase.from('brokers').select('id', { count: 'exact', head: true }).eq('status', 'ativo'),
        supabase.from('subscriptions').select('amount').eq('status', 'paid')
      ]);
      const totalRevenue = (revenueRes.data || []).reduce((sum: number, s: any) => sum + (s.amount || 0), 0);
      res.json({
        totalBrokers: brokersRes.count || 0,
        activeBrokers: activeRes.count || 0,
        totalProperties: propertiesRes.count || 0,
        totalLeads: leadsRes.count || 0,
        totalRevenueCents: totalRevenue
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Ativar ou bloquear um corretor
  app.patch("/api/admin/brokers/:id/status", async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    const { status } = req.body;
    if (!['ativo', 'pendente', 'bloqueado'].includes(status)) {
      return res.status(400).json({ error: "Status inválido" });
    }
    try {
      const { data, error } = await supabase
        .from('brokers').update({ status }).eq('id', req.params.id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Detalhes de um corretor (imóveis, leads, assinaturas)
  app.get("/api/admin/brokers/:id", async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    try {
      const [brokerRes, propsRes, subsRes] = await Promise.all([
        supabase.from('brokers').select('*').eq('id', req.params.id).single(),
        supabase.from('properties').select('id, title, status, created_at').eq('broker_id', req.params.id).order('created_at', { ascending: false }),
        supabase.from('subscriptions').select('*').eq('broker_id', req.params.id).order('created_at', { ascending: false })
      ]);
      if (brokerRes.error) throw brokerRes.error;
      res.json({
        broker: brokerRes.data,
        properties: propsRes.data || [],
        subscriptions: subsRes.data || []
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // FUNÇÕES DE AUTOMAÇÃO — ATIVAÇÃO E Z-PRO
  // ─────────────────────────────────────────────────────────────────────────

  async function handleAsaasPaymentReceived({ id, customerId, value, brokerId, subscriptionId }: {
    id: string; customerId: string; value: number; brokerId: string; subscriptionId?: string;
  }) {
    try {
      const validUntil = new Date();
      validUntil.setMonth(validUntil.getMonth() + 1);

      const brokerUpdate: any = {
        status: 'ativo',
        asaas_customer_id: customerId,
        plan: 'mensal',
        valid_until: validUntil.toISOString(),
        grace_until: null   // pagamento confirmado limpa inadimplência/grace
      };
      if (subscriptionId) brokerUpdate.asaas_subscription_id = subscriptionId;

      await supabase.from('brokers').update(brokerUpdate).eq('id', brokerId);

      await supabase.from('subscriptions').insert({
        broker_id: brokerId,
        asaas_payment_id: id,
        asaas_customer_id: customerId,
        plan: 'mensal',
        amount: Math.round(value * 100),
        currency: 'brl',
        status: 'paid',
        paid_at: new Date().toISOString(),
        valid_until: validUntil.toISOString()
      });

      const { data: broker } = await supabase.from('brokers').select('*').eq('id', brokerId).single();
      if (!broker) return;

      if (ZPRO_ADMIN_URL && ZPRO_ADMIN_TOKEN && broker.provisioning_status !== 'completed') {
        await createZproTenantAndChannel(broker);
      }

      console.log(`✅ Corretor ${brokerId} ativado — Asaas ${id}`);
    } catch (err: any) {
      console.error("Erro ao ativar corretor:", err);
    }
  }

  function generateSecurePassword(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let pwd = '';
    for (let i = 0; i < 12; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
    return pwd + 'A1!';
  }

  function buildZproUsername(broker: any): string {
    const base = (broker.email || broker.id || 'corretor')
      .split('@')[0]
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase()
      .slice(0, 16);
    const suffix = String(broker.id || '').replace(/-/g, '').slice(0, 4);
    return `${base}${suffix}`;
  }

  async function fireProvisioningWebhook(payload: any) {
    if (!PROVISIONING_WEBHOOK_URL) return;
    try {
      const resp = await fetch(PROVISIONING_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      await supabase.from('webhook_logs').insert({
        source: 'provisioning_webhook',
        event_type: resp.ok ? 'webhook_delivered' : 'webhook_failed',
        payload: { url: PROVISIONING_WEBHOOK_URL, status: resp.status, body: payload },
        status: resp.ok ? 'processed' : 'error',
        broker_id: payload.broker?.id || null
      });
    } catch (err: any) {
      await supabase.from('webhook_logs').insert({
        source: 'provisioning_webhook',
        event_type: 'webhook_failed',
        payload: { url: PROVISIONING_WEBHOOK_URL, error: err.message, body: payload },
        status: 'error',
        broker_id: payload.broker?.id || null
      });
    }
  }

  // Aponta o webhook N8N do canal pro fluxo da IA. O painel Z-PRO salva isso via
  // WebSocket; aqui tentamos a via REST equivalente. Não bloqueia o provisionamento:
  // se a config N8N "para todos os tickets" estiver ON no tenant, o roteamento já
  // funciona globalmente. Isolada pra trocar o endpoint sem tocar no fluxo.
  async function setN8nWebhook(
    tenantId: string | number,
    whatsappId: string | number,
    tenantHeaders: Record<string, string>
  ): Promise<boolean> {
    if (!N8N_WEBHOOK_URL) return false;
    const attempts: Array<{ method: string; path: string; body: any }> = [
      { method: 'PUT', path: `/whatsappN8nUrl/${whatsappId}`, body: { id: Number(whatsappId), n8nUrl: N8N_WEBHOOK_URL } },
      { method: 'PUT', path: `/tenantsN8nUrl/${tenantId}`,     body: { id: Number(tenantId), n8nUrl: N8N_WEBHOOK_URL } },
      { method: 'PUT', path: `/whatsapp/${whatsappId}`,        body: { id: Number(whatsappId), n8nUrl: N8N_WEBHOOK_URL } },
    ];
    for (const att of attempts) {
      try {
        const r = await fetch(`${ZPRO_ADMIN_URL}${att.path}`, {
          method: att.method,
          headers: tenantHeaders,
          body: JSON.stringify(att.body)
        });
        if (r.ok) {
          console.log(`[Z-PRO] N8N webhook do canal setado via ${att.method} ${att.path}`);
          return true;
        }
      } catch { /* tenta próximo */ }
    }
    console.warn('[Z-PRO] N8N webhook do canal: endpoint REST não confirmado — '
      + 'config "N8N para todos os tickets" no tenant cobre o roteamento globalmente');
    return false;
  }

  async function createZproTenantAndChannel(broker: any) {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${ZPRO_ADMIN_TOKEN}` };
    const brokerName = broker.name || `Corretor ${broker.id}`;

    // Gera credenciais ANTES — persistidas no Supabase imediatamente
    const tenantPassword = broker.zpro_password || generateSecurePassword();
    const tenantUsername = broker.zpro_username || buildZproUsername(broker);
    const tenantEmail = broker.email || `${tenantUsername}@imobiflow.local`;

    await supabase.from('brokers').update({
      zpro_password: tenantPassword,
      zpro_username: tenantUsername,
      zpro_user_email: tenantEmail,
      provisioning_status: broker.zpro_tenant_id ? 'tenant_created' : 'pending',
      provisioning_error: null
    }).eq('id', broker.id);

    try {
      let tenantId: number | string | undefined = broker.zpro_tenant_id && broker.zpro_tenant_id !== 'undefined'
        ? broker.zpro_tenant_id
        : undefined;
      let adminUserId: number | undefined;

      // 1. Cria tenant — pula se já existe (idempotente)
      if (!tenantId) {
        const tenantResp = await fetch(`${ZPRO_ADMIN_URL}/tenantApiStoreTenant`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: brokerName,
            email: tenantEmail,
            password: tenantPassword,
            userName: tenantUsername,
            status: 'active',
            maxUsers: 5,
            maxConnections: 1,
            acceptTerms: true,
            profile: 'admin',
            uazapiHost: UAZAPI_HOST,
            uazapiToken: UAZAPI_TOKEN
          })
        });

        if (!tenantResp.ok) throw new Error(`Z-PRO tenant error: ${await tenantResp.text()}`);
        const tenant = await tenantResp.json();
        tenantId = tenant.id || tenant.tenant_id || tenant.tenantId
          || tenant.data?.id || tenant.tenant?.id || tenant.result?.id;
        adminUserId = tenant.user?.id || tenant.userId || tenant.adminUserId
          || tenant.data?.user?.id || tenant.result?.user?.id;

        if (!tenantId) throw new Error(`Z-PRO tenant ID ausente no response: ${JSON.stringify(tenant)}`);

        await supabase.from('brokers').update({
          zpro_tenant_id: String(tenantId),
          provisioning_status: 'tenant_created'
        }).eq('id', broker.id);
      } else {
        console.log(`[Z-PRO] Tenant ${tenantId} já existe — pulando StoreTenant`);
      }

      // 1b. Plano A — login como user admin do tenant pra obter token de sessão
      let tenantUserToken: string | null = null;
      try {
        const loginResp = await fetch(`${ZPRO_ADMIN_URL}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: tenantEmail, password: tenantPassword })
        });
        if (loginResp.ok) {
          const loginData = await loginResp.json();
          tenantUserToken = loginData.token || loginData.access_token || loginData.accessToken
            || loginData.data?.token || null;
          if (tenantUserToken) console.log(`[Z-PRO] Login user-tenant OK`);
        }
      } catch (e) {
        console.warn('[Z-PRO] Login user-tenant falhou:', (e as any)?.message);
      }
      const tenantHeaders = tenantUserToken
        ? { 'Content-Type': 'application/json', Authorization: `Bearer ${tenantUserToken}` }
        : headers;

      // 1c. Seta uazapiHost + uazapiToken — endpoint único, body com ambos os campos
      //     PUT /tenantsUazapiHost/{tenantId}  body: {id, uazapiHost, uazapiToken}
      let uazapiConfigOk = false;
      try {
        const r = await fetch(`${ZPRO_ADMIN_URL}/tenantsUazapiHost/${tenantId}`, {
          method: 'PUT',
          headers: tenantHeaders,
          body: JSON.stringify({
            id: Number(tenantId),
            uazapiHost: UAZAPI_HOST,
            uazapiToken: UAZAPI_TOKEN
          })
        });
        uazapiConfigOk = r.ok;
        console.log(`[Z-PRO] uazapi config status=${r.status} ok=${uazapiConfigOk}`);
      } catch (e) {
        console.warn('[Z-PRO] uazapi config falhou:', (e as any)?.message);
      }
      if (!uazapiConfigOk) console.warn(`[Z-PRO] tenantsUazapiHost rejeitou — sessão pode falhar`);

      // 2. Cria sessão WhatsApp — já retorna canal + API + QR code juntos no Z-PRO
      let whatsappId: number | string | undefined = broker.zpro_channel_id && broker.zpro_channel_id !== 'undefined'
        ? broker.zpro_channel_id
        : undefined;
      let apiId: string | undefined;
      let plainToken: string | undefined;
      let initialQrCode: string | undefined;

      if (!whatsappId) {
        const sessionResp = await fetch(`${ZPRO_ADMIN_URL}/tenantApiCreateSession`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            tenantId: Number(tenantId),
            tenant: Number(tenantId),
            userId: adminUserId ? Number(adminUserId) : undefined,
            name: `WhatsApp - ${brokerName}`,
            status: 'OPENING',
            type: 'uazapi'
          })
        });

        if (!sessionResp.ok) throw new Error(`Z-PRO session error: ${await sessionResp.text()}`);
        const session = await sessionResp.json();
        whatsappId = session.whatsapp?.id || session.id || session.whatsappId;
        apiId = session.api?.apiConfig?.id || session.api?.id;
        plainToken = session.api?.plainToken || session.api?.apiConfig?.authToken;
        initialQrCode = session.whatsapp?.qrcode;

        if (!whatsappId) throw new Error(`Z-PRO whatsappId ausente: ${JSON.stringify(session)}`);
        console.log(`[Z-PRO] Session criada — channel=${whatsappId} api=${apiId} token=${plainToken?.slice(0, 12)}...`);
      } else {
        console.log(`[Z-PRO] Session ${whatsappId} já existe — pulando CreateSession`);
      }

      await supabase.from('brokers').update({
        zpro_channel_id: String(whatsappId),
        zpro_channel_name: `WhatsApp - ${brokerName}`,
        zpro_qr_code: initialQrCode || null,
        provisioning_status: 'session_created'
      }).eq('id', broker.id);

      // 3. API já foi criada junto com a sessão pelo Z-PRO — só usa os IDs retornados
      if (!apiId) apiId = broker.zpro_api_key && broker.zpro_api_key !== 'undefined'
        ? broker.zpro_api_key
        : undefined;
      if (!apiId) throw new Error(`Z-PRO apiId ausente após CreateSession`);
      const apiUrl = `${ZPRO_ADMIN_URL}/v2/api/external/${apiId}`;

      await supabase.from('brokers').update({
        zpro_api_key: String(apiId),
        zpro_api_url: apiUrl,
        zpro_api_token: plainToken || null,
        provisioning_status: 'api_created'
      }).eq('id', broker.id);

      // 3b. Configura N8N no canal (webhook da IA). Endpoint exato a confirmar —
      //     setN8nWebhook é isolada pra ajuste fácil sem mexer no resto do fluxo.
      await setN8nWebhook(tenantId, whatsappId, tenantHeaders);

      // 4. Inicia sessão para disparar geração do QR code — POST /v2/api/external/{apiId}/startSession
      await fetch(`${ZPRO_ADMIN_URL}/v2/api/external/${apiId}/startSession`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ whatsappId: Number(whatsappId) })
      });

      const completedAt = new Date().toISOString();
      await supabase.from('brokers').update({
        provisioning_status: 'completed',
        provisioning_completed_at: completedAt
      }).eq('id', broker.id);

      await supabase.from('webhook_logs').insert({
        source: 'zpro',
        event_type: 'tenant_created',
        payload: { tenant_id: tenantId, whatsapp_id: whatsappId, api_id: apiId, broker_id: broker.id },
        status: 'processed',
        broker_id: broker.id
      });

      console.log(`✅ Z-PRO: tenant ${tenantId} | sessão ${whatsappId} | api ${apiId} — corretor ${broker.id}`);

      // 5. Dispara webhook final com TUDO criado — só aqui, após sucesso completo
      await fireProvisioningWebhook({
        event: 'broker_provisioned',
        provisioned_at: completedAt,
        broker: {
          id: broker.id,
          name: broker.name,
          email: broker.email,
          phone: broker.phone
        },
        zpro: {
          admin_url: ZPRO_ADMIN_URL,
          tenant_id: String(tenantId),
          username: tenantUsername,
          password: tenantPassword,
          email: tenantEmail,
          channel_id: String(whatsappId),
          channel_name: `WhatsApp - ${brokerName}`,
          channel_type: 'uazapi',
          api_id: String(apiId),
          api_url: apiUrl,
          api_token: plainToken || null
        },
        asaas: {
          customer_id: broker.asaas_customer_id || null,
          subscription_id: broker.asaas_subscription_id || null
        }
      });

    } catch (err: any) {
      console.error("Erro ao criar Z-PRO tenant/canal:", err);
      await supabase.from('brokers').update({
        provisioning_status: 'failed',
        provisioning_error: err.message
      }).eq('id', broker.id);
      await supabase.from('webhook_logs').insert({
        source: 'zpro',
        event_type: 'tenant_creation_failed',
        payload: { error: err.message, broker_id: broker.id },
        status: 'error',
        broker_id: broker.id
      });
    }
  }


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
