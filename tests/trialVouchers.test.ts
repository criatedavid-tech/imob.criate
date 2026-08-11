import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  generateTrialVoucherCode,
  hashTrialVoucherCode,
  isValidTrialVoucherCode,
} from "../server/security/trialVoucherCode";

test("voucher usa segredo criptografico forte e formato publico fechado", () => {
  const first = generateTrialVoucherCode();
  const second = generateTrialVoucherCode();
  assert.equal(isValidTrialVoucherCode(first), true);
  assert.equal(isValidTrialVoucherCode(second), true);
  assert.notEqual(first, second);
  assert.match(hashTrialVoucherCode(first), /^[0-9a-f]{64}$/);
  assert.notEqual(hashTrialVoucherCode(first), first);

  for (const invalid of [
    "imf_trial_curto",
    "IMF_TRIAL_01234567890123456789012345678901",
    "' OR 1=1--",
    "a".repeat(1_000),
    "",
  ]) {
    assert.equal(isValidTrialVoucherCode(invalid), false);
  }
});

test("migration guarda apenas hash, protege RLS e resgata voucher atomicamente", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260804_trial_vouchers.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /code_hash\s+TEXT NOT NULL UNIQUE/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.imf_trial_vouchers FROM anon, authenticated/);
  assert.match(migration, /imf_redeem_trial_voucher/);
  assert.match(migration, /WHERE code_hash = p_code_hash\s+FOR UPDATE/);
  assert.match(migration, /status = 'used'/);
  assert.match(migration, /'ativo', 'experimentacao'/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.imf_redeem_trial_voucher/);
});

test("limite de membros da experimentacao e aplicado ao emitir e aceitar convites", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260804_trial_vouchers.sql", import.meta.url),
    "utf8",
  );
  const equipe = await readFile(new URL("../server/routes/equipe.ts", import.meta.url), "utf8");
  const auth = await readFile(new URL("../server/routes/auth.ts", import.meta.url), "utf8");

  assert.match(migration, /imf_create_broker_invite/);
  assert.match(migration, /imf_claim_broker_invite/);
  assert.match(migration, /TRIAL_MEMBER_LIMIT_REACHED/g);
  assert.match(equipe, /rpc\("imf_create_broker_invite"/);
  assert.match(auth, /rpc\("imf_claim_broker_invite"/);
});

test("voucher separa vagas da equipe da cota atomica de WhatsApp proprio", async () => {
  const [migration, admin, auth, equipe, billing, adminUi, signup, configUi, payment] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260804b_trial_voucher_whatsapp.sql", import.meta.url), "utf8"),
    readFile(new URL("../server/routes/admin.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/routes/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/routes/equipe.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/routes/billing.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/AdminTrialVouchers.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Signup.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/experience/ConfigArea.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/PaymentPending.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /ADD COLUMN IF NOT EXISTS whatsapp_member_limit INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS trial_whatsapp_member_limit INTEGER/);
  assert.match(migration, /whatsapp_member_limit <= member_limit/);
  assert.match(migration, /trial_whatsapp_member_limit <= COALESCE\(trial_member_limit, 0\)/);
  assert.match(migration, /trial_started_at, trial_ends_at, trial_member_limit, trial_whatsapp_member_limit/);
  assert.match(migration, /TRIAL_WHATSAPP_LIMIT_REACHED/g);
  assert.match(migration, /WHATSAPP_MEMBER_LIMIT_REACHED/g);
  assert.match(migration, /i\.used_at IS NULL[\s\S]*i\.expires_at > NOW\(\)/);
  assert.match(migration, /FOR UPDATE/);

  assert.match(admin, /whatsapp_member_limit: z\.number\(\)/);
  assert.match(admin, /whatsapp_member_limit: whatsappMemberLimit/);
  assert.match(auth, /whatsapp_member_limit: voucher\.account_type/);
  assert.match(equipe, /effectiveWhatsappMemberLimit/);
  assert.match(equipe, /trial_whatsapp_member_limit/);
  assert.match(equipe, /cota de WhatsApps próprios é definida pelo voucher/);
  assert.match(adminUi, /Corretores com WhatsApp próprio/);
  assert.match(signup, /equipe com WhatsApp compartilhado/);
  assert.match(configUi, /liberada\{status\.member_limit === 1 \? '' : 's'\} pelo voucher/);

  assert.match(billing, /memberLimit < \(memberWhatsappInUse \|\| 0\)/);
  assert.match(billing, /memberWhatsappInUse:/);
  assert.match(payment, /Math\.max\(memberSlotsInUse, v - 1\)/);
});

test("plano pago confirma e contrata slot junto com a criacao do convite", async () => {
  const [migration, equipe, equipeUi] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260804c_team_invite_slot_upgrade.sql", import.meta.url), "utf8"),
    readFile(new URL("../server/routes/equipe.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/experience/EquipeArea.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /p_confirm_add_whatsapp_slot BOOLEAN DEFAULT FALSE/);
  assert.match(migration, /WHERE id = p_broker_id\s+FOR UPDATE/);
  assert.match(migration, /IF NOT p_confirm_add_whatsapp_slot THEN/);
  assert.match(migration, /UPDATE public\.imf_brokers AS broker[\s\S]*SET member_limit = v_new_member_limit/);
  assert.match(migration, /INSERT INTO public\.imf_broker_invites/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS request_id UUID/);
  assert.match(migration, /imf_broker_invites_request_id_unique/);
  assert.match(migration, /invite\.request_id = p_request_id/);
  assert.match(migration, /added_whatsapp_slot/);
  assert.match(migration, /RETURNS TABLE \([\s\S]*invite_id UUID,[\s\S]*slot_added BOOLEAN,[\s\S]*member_limit INTEGER/);

  assert.match(equipe, /p_confirm_add_whatsapp_slot: confirmAddWhatsappSlot/);
  assert.match(equipe, /p_request_id: requestId/);
  assert.match(equipe, /z\.string\(\)\.uuid\(\)\.safeParse\(requestIdInput\)/);
  assert.match(equipe, /WHATSAPP_SLOT_CONFIRMATION_REQUIRED/);
  assert.match(equipe, /slot_price: MEMBER_WHATSAPP_SLOT_PRICE/);
  assert.match(equipe, /next_monthly_value: subscriptionValueForMemberLimit\(nextLimit\)/);

  assert.match(equipeUi, /Confirmar acréscimo e gerar convite/);
  assert.match(equipeUi, /Voltar sem alterar o plano/);
  assert.match(equipeUi, /Convidar com WhatsApp compartilhado/);
  assert.match(equipeUi, /confirm_add_whatsapp_slot: confirmAddWhatsappSlot/);
  assert.match(equipeUi, /request_id: requestId/);
  assert.match(equipeUi, /crypto\.randomUUID\(\)/);
});

test("rotas administrativas de voucher exigem admin e nunca listam codigo bruto", async () => {
  const admin = await readFile(new URL("../server/routes/admin.ts", import.meta.url), "utf8");
  for (const marker of [
    'post("/api/admin/trial-vouchers"',
    'get("/api/admin/trial-vouchers"',
    'patch("/api/admin/trial-vouchers/:id/cancel"',
    'patch("/api/admin/trial-vouchers/:id/revoke"',
  ]) {
    const start = admin.indexOf(marker);
    assert.ok(start >= 0, marker);
    const route = admin.slice(start, start + 3_000);
    assert.match(route, /requireAdmin\(req, res\)/);
  }

  const listStart = admin.indexOf('get("/api/admin/trial-vouchers"');
  const listEnd = admin.indexOf('patch("/api/admin/trial-vouchers/:id/cancel"', listStart);
  const listRoute = admin.slice(listStart, listEnd);
  assert.doesNotMatch(listRoute, /select\([^)]*code_hash/);
  assert.doesNotMatch(listRoute, /row\.code_hash/);
});

test("admin revoga convite ou acesso de experimentacao de forma atomica", async () => {
  const [migration, route, ui] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260811c_trial_voucher_revocation.sql", import.meta.url), "utf8"),
    readFile(new URL("../server/routes/admin.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/AdminTrialVouchers.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.imf_revoke_trial_voucher/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /v_voucher\.status NOT IN \('active', 'used'\)/);
  assert.match(migration, /v_broker\.plan IS DISTINCT FROM 'experimentacao'/);
  assert.match(migration, /UPDATE public\.imf_brokers[\s\S]*status = 'inativo'/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.imf_revoke_trial_voucher/);
  assert.match(route, /rpc\("imf_revoke_trial_voucher"/);
  assert.match(route, /invalidateAccountAccessCache\(\)/);
  assert.match(ui, /Revogar acesso/);
  assert.match(ui, /Revogar voucher/);
});

test("cadastro com voucher usa RPC e remove usuario se o resgate falhar", async () => {
  const auth = await readFile(new URL("../server/routes/auth.ts", import.meta.url), "utf8");
  const start = auth.indexOf('post("/api/auth/signup"');
  const end = auth.indexOf("const loginSchema", start);
  const signup = auth.slice(start, end);

  assert.match(signup, /validateBody\(signupSchema\)/);
  assert.match(signup, /rpc\("imf_redeem_trial_voucher"/);
  assert.match(signup, /deleteUser\(createdUserId\)/);
  assert.match(signup, /Este voucher é inválido, expirou ou já foi utilizado/);
});

test("app libera somente conta ativa e voucher nao passa pela tela de pagamento", async () => {
  const [app, signup] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Signup.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(app, /status !== 'ativo'/);
  assert.match(app, /experimentacao\/:voucherCode/);
  assert.match(signup, /voucherCode \? '\/app' : '\/payment'/);
  assert.match(signup, /Modalidade do convite/);
});

test("backend bloqueia APIs depois do teste e deixa apenas o caminho de contratação", async () => {
  const middleware = await readFile(new URL("../server/middleware/auth.ts", import.meta.url), "utf8");
  assert.match(middleware, /broker\?\.plan === "experimentacao"/);
  assert.match(middleware, /update\(\{ status: "inativo" \}\)/);
  assert.match(middleware, /status\(402\)/);
  assert.match(middleware, /"GET \/api\/subscription"/);
  assert.match(middleware, /"POST \/api\/checkout"/);
  assert.doesNotMatch(middleware, /"PATCH \/api\/brokers\/me"/);
});
