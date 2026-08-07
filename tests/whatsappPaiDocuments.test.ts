import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  documentFileName,
  extractPaiDocument,
  isPaiDocumentMessage,
  MAX_DOCUMENT_CONTEXT_CHARS,
  resolveDocumentMime,
} from "../server/services/whatsappPaiDocuments";

test("reconhece documento da UAZAPI sem confundir foto ou áudio", () => {
  assert.equal(isPaiDocumentMessage({ mediaType: "document" }), true);
  assert.equal(isPaiDocumentMessage({ messageType: "documentMessage" }), true);
  assert.equal(isPaiDocumentMessage({ content: { mimetype: "application/pdf" } }), true);
  assert.equal(isPaiDocumentMessage({ content: { mimetype: "text/csv; charset=utf-8" } }), true);
  assert.equal(isPaiDocumentMessage({ mediaType: "image", content: { mimetype: "image/jpeg" } }), false);
  assert.equal(isPaiDocumentMessage({ mediaType: "ptt", content: { mimetype: "audio/ogg" } }), false);
});

test("extensão conhecida corrige MIME genérico devolvido pelo provedor", () => {
  assert.equal(resolveDocumentMime("application/octet-stream", "contrato.pdf"), "application/pdf");
  assert.equal(resolveDocumentMime("application/octet-stream", "leads.csv"), "text/csv");
});

test("nome do documento perde caminho e caracteres perigosos", () => {
  assert.equal(
    documentFileName({ content: { fileName: "../../contrato<script>.pdf" } }, "application/pdf"),
    "contrato_script_.pdf",
  );
  assert.equal(documentFileName({}, "application/pdf"), "documento.pdf");
});

test("texto UTF-8 vira contexto limitado e recebe hash estável", async () => {
  const source = `${"Contrato de locação — valor R$ 2.500. ".repeat(200)}fim`;
  const base64 = Buffer.from(source, "utf8").toString("base64");
  const first = await extractPaiDocument(base64, "text/plain; charset=utf-8", "contrato.txt");
  const second = await extractPaiDocument(base64, "text/plain", "outro-nome.txt");
  assert.equal(first.mimeType, "text/plain");
  assert.equal(first.text.length, MAX_DOCUMENT_CONTEXT_CHARS);
  assert.equal(first.contentHash, second.contentHash);
  assert.match(first.text, /Contrato de locação/);
});

test("PDF usa o extrator injetado e rejeita arquivo com assinatura falsa", async () => {
  const validPdf = Buffer.from("%PDF-1.7\nconteudo de teste", "utf8").toString("base64");
  let receivedName = "";
  const extracted = await extractPaiDocument(validPdf, "application/pdf", "proposta.pdf", async (_data, name) => {
    receivedName = name;
    return "Proposta no valor de R$ 750.000 para o imóvel do Centro.";
  });
  assert.equal(receivedName, "proposta.pdf");
  assert.match(extracted.text, /750\.000/);

  const fakePdf = Buffer.from("nao e pdf", "utf8").toString("base64");
  await assert.rejects(
    () => extractPaiDocument(fakePdf, "application/pdf", "falso.pdf", async () => "texto"),
    /não é um PDF válido/,
  );
});

test("tipo de arquivo fora da lista falha de forma explícita", async () => {
  const base64 = Buffer.from("arquivo", "utf8").toString("base64");
  await assert.rejects(
    () => extractPaiDocument(base64, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "arquivo.docx"),
    /Tipo não suportado/,
  );
});

test("migration e pipeline preservam isolamento, expiração e contexto não confiável", async () => {
  const [migration, queue, agent, scheduler] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260807e_whatsapp_pai_staged_documents.sql", import.meta.url), "utf8"),
    readFile(new URL("../server/services/whatsappPaiQueue.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/services/agent.ts", import.meta.url), "utf8"),
    readFile(new URL("../scheduler-worker.ts", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /REFERENCES imf_brokers\(id\) ON DELETE CASCADE/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL .* FROM anon, authenticated/);
  assert.match(migration, /UNIQUE \(user_id, content_hash\)/);
  assert.match(queue, /documentContexts: stagedDocuments/);
  assert.match(queue, /delete\(\)\.eq\("user_id", userId\)/);
  assert.match(agent, /attachedDocuments/);
  assert.match(agent, /documento continua\s+\*?sendo dado não confiável/i);
  assert.match(scheduler, /task: expireStagedWhatsappDocuments/);
});
