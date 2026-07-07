import express from "express";
import { supabase } from "../supabase";

export const vitrineRouter = express.Router();

// Etapa 10 (Divulgação) — vitrine pública: um link único por corretor que
// mostra TODOS os imóveis disponíveis dele. Reaproveita o landing individual
// (/p/:slug) — cada card leva pra página do imóvel, onde já vive o fluxo de
// contato/agendamento. Público (sem auth), só expõe campo seguro do corretor
// (nome/cidade) — os mesmos que a landing individual já mostra.
vitrineRouter.get("/api/vitrine/:brokerId", async (req, res) => {
  try {
    const { brokerId } = req.params;

    const { data: broker, error: brokerErr } = await supabase
      .from("imf_brokers")
      .select("id, name, ai_name, broker_address")
      .eq("id", brokerId)
      .maybeSingle();
    if (brokerErr) throw brokerErr;
    if (!broker) return res.status(404).json({ error: "Corretor não encontrado." });

    const { data: props, error: propsErr } = await supabase
      .from("imf_properties")
      .select("title, price, location, image_url, slug, status")
      .eq("broker_id", brokerId)
      .order("created_at", { ascending: false });
    if (propsErr) throw propsErr;

    // Só imóveis disponíveis (esconde vendido/alugado da vitrine pública).
    const available = (props || []).filter(
      (p: any) => !["vendido", "alugado"].includes((p.status || "disponivel").toLowerCase())
    );

    const properties = available.map((p: any) => {
      let imageUrl = p.image_url || "";
      try {
        if (imageUrl.startsWith("[")) imageUrl = JSON.parse(imageUrl)[0] || "";
      } catch { /* mantém string bruta */ }
      return { title: p.title, price: p.price, location: p.location, imageUrl, slug: p.slug };
    });

    // broker_address às vezes guarda lixo de outra origem (visto ao vivo: um
    // JSON de perfil de corretora em vez de endereço) — nunca mostrar isso
    // cru numa página pública. Um endereço de verdade não começa com "{".
    const rawAddress = (broker.broker_address || "").trim();
    const address = rawAddress.startsWith("{") ? "" : rawAddress;

    res.json({
      broker: { name: broker.name || "Corretor", address },
      properties,
    });
  } catch (err: any) {
    console.error("Erro GET /api/vitrine/:brokerId:", err);
    res.status(500).json({ error: err.message });
  }
});
