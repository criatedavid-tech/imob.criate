import { randomUUID } from "node:crypto";
import { supabase } from "../supabase";

type ConversationTicketStatus = "pending" | "open" | "closed";

export interface ConversationTicket {
  id: string;
  broker_id: string;
  customer_phone: string;
  conversation_status: ConversationTicketStatus;
  ai_active: boolean;
  human_takeover_at: string | null;
  queue_id: string | null;
  assigned_user_id: string | null;
  instance_owner_user_id: string | null;
  opened_at: string;
  closed_at: string | null;
  last_activity_at: string;
}

interface EnsureTicketOptions {
  brokerId: string;
  customerPhone: string;
  initialStatus: Exclude<ConversationTicketStatus, "closed">;
  aiActive?: boolean;
  assignedUserId?: string | null;
  instanceOwnerUserId?: string | null;
  lastActivityAt?: string;
}

export async function getConversationTicket(
  brokerId: string,
  ticketId: string,
): Promise<ConversationTicket | null> {
  const { data, error } = await supabase
    .from("imf_conversation_tickets")
    .select("id, broker_id, customer_phone, conversation_status, ai_active, human_takeover_at, queue_id, assigned_user_id, instance_owner_user_id, opened_at, closed_at, last_activity_at")
    .eq("id", ticketId)
    .eq("broker_id", brokerId)
    .maybeSingle();
  if (error) throw error;
  return (data as ConversationTicket | null) || null;
}

async function findActiveTicket(brokerId: string, customerPhone: string): Promise<ConversationTicket | null> {
  const { data, error } = await supabase
    .from("imf_conversation_tickets")
    .select("id, broker_id, customer_phone, conversation_status, ai_active, human_takeover_at, queue_id, assigned_user_id, instance_owner_user_id, opened_at, closed_at, last_activity_at")
    .eq("broker_id", brokerId)
    .eq("customer_phone", customerPhone)
    .in("conversation_status", ["pending", "open"])
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as ConversationTicket | null) || null;
}

async function syncCurrentConversation(
  ticket: ConversationTicket,
  activityAt: string,
  instanceOwnerUserId?: string | null,
): Promise<void> {
  const { error } = await supabase.from("followup_conversations").upsert({
    broker_id: ticket.broker_id,
    customer_phone: ticket.customer_phone,
    ticket_id: ticket.id,
    conversation_status: ticket.conversation_status,
    ai_active: ticket.ai_active,
    human_takeover_at: ticket.human_takeover_at,
    queue_id: ticket.queue_id,
    assigned_user_id: ticket.assigned_user_id,
    instance_owner_user_id: instanceOwnerUserId === undefined
      ? ticket.instance_owner_user_id
      : instanceOwnerUserId,
    updated_at: activityAt,
  }, { onConflict: "broker_id,customer_phone" });
  if (error) throw error;
}

export async function ensureConversationTicket(options: EnsureTicketOptions): Promise<ConversationTicket> {
  const activityAt = options.lastActivityAt || new Date().toISOString();
  const active = await findActiveTicket(options.brokerId, options.customerPhone);

  if (active) {
    const ticketUpdates: Record<string, unknown> = {
      last_activity_at: activityAt,
      updated_at: activityAt,
    };
    if (options.instanceOwnerUserId !== undefined) {
      ticketUpdates.instance_owner_user_id = options.instanceOwnerUserId;
    }
    const { error } = await supabase
      .from("imf_conversation_tickets")
      .update(ticketUpdates)
      .eq("id", active.id)
      .eq("broker_id", options.brokerId);
    if (error) throw error;

    const synchronized = { ...active, ...ticketUpdates } as ConversationTicket;
    await syncCurrentConversation(synchronized, activityAt, options.instanceOwnerUserId);
    return synchronized;
  }

  const id = randomUUID();
  const ticket = {
    id,
    broker_id: options.brokerId,
    customer_phone: options.customerPhone,
    conversation_status: options.initialStatus,
    ai_active: options.aiActive ?? true,
    assigned_user_id: options.assignedUserId ?? null,
    instance_owner_user_id: options.instanceOwnerUserId ?? null,
    opened_at: activityAt,
    last_activity_at: activityAt,
    updated_at: activityAt,
  };

  const { data, error } = await supabase
    .from("imf_conversation_tickets")
    .insert(ticket)
    .select("id, broker_id, customer_phone, conversation_status, ai_active, human_takeover_at, queue_id, assigned_user_id, instance_owner_user_id, opened_at, closed_at, last_activity_at")
    .single();

  if (error) {
    // Dois webhooks do mesmo número podem chegar juntos. O índice parcial
    // garante um único ticket ativo; o perdedor reutiliza o vencedor.
    if ((error as any).code === "23505") {
      const concurrent = await findActiveTicket(options.brokerId, options.customerPhone);
      if (concurrent) {
        await syncCurrentConversation(concurrent, activityAt, options.instanceOwnerUserId);
        return concurrent;
      }
    }
    throw error;
  }

  const { error: currentError } = await supabase.from("followup_conversations").upsert({
    broker_id: options.brokerId,
    customer_phone: options.customerPhone,
    ticket_id: id,
    conversation_status: options.initialStatus,
    ai_active: options.aiActive ?? true,
    assigned_user_id: options.assignedUserId ?? null,
    instance_owner_user_id: options.instanceOwnerUserId ?? null,
    human_takeover_at: null,
    follow_sent: false,
    follow_message_index: 0,
    updated_at: activityAt,
  }, { onConflict: "broker_id,customer_phone" });
  if (currentError) throw currentError;

  return data as ConversationTicket;
}

export async function recordConversationMessage(input: {
  brokerId: string;
  customerPhone: string;
  direction: "in" | "out";
  senderType: "customer" | "ai" | "broker_manual";
  body: string | null;
  providerMessageId?: string | null;
  ticketId?: string;
  initialStatus?: "pending" | "open";
  aiActive?: boolean;
  assignedUserId?: string | null;
  instanceOwnerUserId?: string | null;
}) {
  const ticket = input.ticketId
    ? await getConversationTicket(input.brokerId, input.ticketId)
    : await ensureConversationTicket({
        brokerId: input.brokerId,
        customerPhone: input.customerPhone,
        initialStatus: input.initialStatus || "open",
        aiActive: input.aiActive,
        assignedUserId: input.assignedUserId,
        instanceOwnerUserId: input.instanceOwnerUserId,
      });
  if (!ticket || ticket.customer_phone !== input.customerPhone) {
    throw new Error("Ticket de conversa inválido.");
  }

  const { data, error } = await supabase.from("imf_conversation_messages").insert({
    broker_id: input.brokerId,
    customer_phone: input.customerPhone,
    ticket_id: ticket.id,
    direction: input.direction,
    sender_type: input.senderType,
    body: input.body,
    provider_message_id: input.providerMessageId || null,
  }).select().single();
  if (error) throw error;

  const activityAt = data.created_at || new Date().toISOString();
  await Promise.all([
    supabase.from("imf_conversation_tickets").update({
      last_activity_at: activityAt,
      updated_at: activityAt,
    }).eq("id", ticket.id).eq("broker_id", input.brokerId),
    supabase.from("followup_conversations").update({
      updated_at: activityAt,
    }).eq("broker_id", input.brokerId).eq("ticket_id", ticket.id),
  ]);
  return { message: data, ticket };
}
