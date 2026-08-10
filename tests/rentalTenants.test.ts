import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("migration cria inquilinos isolados por conta e preserva contratos legados", async () => {
  const sql = await read("../supabase/migrations/20260803c_rental_tenants.sql");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.imf_rental_tenants/);
  assert.match(sql, /ALTER TABLE public\.imf_rental_tenants ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.imf_rental_tenants FROM anon, authenticated/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public\.imf_rental_tenants/);
  assert.match(sql, /INSERT INTO public\.imf_rental_tenants[\s\S]*FROM public\.imf_rental_contracts/);
  assert.match(sql, /imf_validate_rental_contract_tenant/);
  assert.match(sql, /broker_id = NEW\.broker_id/);
});

test("rotas de inquilinos resolvem o tenant pela sessao e preservam historico", async () => {
  const source = await read("../server/routes/locacao.ts");

  assert.match(source, /locacaoRouter\.get\("\/api\/locacao\/tenants"/);
  assert.match(source, /locacaoRouter\.post\([\s\S]*"\/api\/locacao\/tenants"/);
  assert.match(source, /locacaoRouter\.patch\([\s\S]*"\/api\/locacao\/tenants\/:id"/);
  assert.match(source, /getBrokerId\(\(req as any\)\.userId\)/);
  assert.match(source, /\.eq\("broker_id", brokerId\)/);
  assert.match(source, /possui historico contratual/);
  assert.doesNotMatch(source, /broker_id:\s*req\.body\.broker_id/);
});

test("contratos validam posse do imovel e do inquilino antes de vincular", async () => {
  const source = await read("../server/routes/locacao.ts");

  assert.match(source, /async function ownsProperty/);
  assert.match(source, /findTenantForBroker\(brokerId, tenant_id\)/);
  assert.match(source, /findTenantForBroker\(brokerId, req\.body\.tenant_id\)/);
  assert.match(source, /Imovel invalido para esta conta/);
  assert.match(source, /Inquilino invalido para esta conta/);
});

test("edicoes parciais nao reaplicam valores padrao nem reativam cadastros", async () => {
  const source = await read("../server/routes/locacao.ts");
  const contractFields = source.match(/const contractFields = \{[\s\S]*?\n\};/)?.[0] || "";
  const tenantUpdate = source.match(/const tenantUpdateSchema = z\.object\(\{[\s\S]*?\n\}\)\.partial\(\);/)?.[0] || "";

  assert.ok(contractFields.length > 0);
  assert.ok(tenantUpdate.length > 0);
  assert.doesNotMatch(contractFields, /\.default\(/);
  assert.doesNotMatch(tenantUpdate, /\.default\(/);
});

test("interface de alugueis oferece cadastro e historico sem sair do modulo", async () => {
  const source = await read("../src/experience/LocacaoArea.tsx");

  assert.match(source, /Imóveis alugados/);
  assert.match(source, /Inquilinos \(/);
  assert.match(source, /function TenantModal/);
  assert.match(source, /function PropertyHistoryModal/);
  assert.match(source, /\/api\/locacao\/tenants/);
  assert.match(source, /Situação financeira/);
  assert.match(source, /Adimplente/);
  assert.match(source, /Inadimplente/);
});

test("carteira de locacao continua operavel com dezenas de clientes", async () => {
  const source = await read("../src/experience/LocacaoArea.tsx");

  assert.match(source, /const RENTAL_PAGE_SIZE = 12/);
  assert.match(source, /Voltar para Aluguéis/);
  assert.match(source, /Cadastros, contatos, contratos e situação financeira dos locatários/);
  assert.match(source, /view !== 'tenants'/);
  assert.match(source, /setView\('contracts'\)/);
  assert.match(source, /Prioridade operacional/);
  assert.match(source, /Buscar inquilino, im.vel, propriet.rio ou telefone/);
  assert.match(source, /Buscar por nome, im.vel, telefone, e-mail ou CPF\/CNPJ/);
  assert.match(source, /contractFinancialFilter/);
  assert.match(source, /tenantFinancialFilter/);
  assert.match(source, /contractDisplay === 'lista'/);
  assert.match(source, /tenantDisplay === 'lista'/);
  assert.match(source, /RentalPagination page=\{contractPage\}/);
  assert.match(source, /RentalPagination page=\{tenantPage\}/);
});

test("api consolida adimplencia por contrato ativo sem confiar no cliente", async () => {
  const source = await read("../server/routes/locacao.ts");

  assert.match(source, /loadContractFinancialHealth/);
  assert.match(source, /summarizeRentalFinancialHealth/);
  assert.match(source, /summarizeTenantFinancialHealth/);
  assert.match(source, /overdue_amount_cents/);
  assert.match(source, /overdue_count/);
});
