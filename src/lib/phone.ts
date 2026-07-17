// Mesma normalização usada no backend (server/lib/crypto.ts) — telefone BR
// pro formato exigido pelo WhatsApp/UAZAPI: DDI 55 + DDD (2) + 8 dígitos,
// sem o nono dígito. Ex.: "(62) 99159-2150" -> "556291592150"
export function normalizePhoneBR(raw: string): string {
  let d = (raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  const ddd = d.slice(0, 2);
  let num = d.slice(2);
  if (num.length === 9 && num.startsWith('9')) num = num.slice(1);
  return `55${ddd}${num}`;
}

// Tamanho máximo de um número local BR (DDD + até 9 dígitos do celular) —
// o input já mostra "+55" fixo ao lado, então o campo só digita esta parte.
const BR_LOCAL_MAX_LEN = 11;

// Filtro pro campo de input: mantém só dígitos e trava no tamanho máximo de
// um telefone BR local, pra não deixar colar/digitar um número sem fim.
export function digitsOnly(raw: string, maxLen = BR_LOCAL_MAX_LEN): string {
  return (raw || '').replace(/\D/g, '').slice(0, maxLen);
}

// Tira o DDI 55 de um telefone já salvo (formato 55DDDNNNNNNNN) pra exibir só
// DDD+número ao lado do prefixo fixo "+55" — evita duplicar o 55 ao editar.
// Usa o dígito cru (sem o corte do digitsOnly) porque precisa ver os 12-13
// dígitos completos antes de decidir se tem DDI.
export function stripDDI(raw: string): string {
  const d = (raw || '').replace(/\D/g, '');
  return d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
}
