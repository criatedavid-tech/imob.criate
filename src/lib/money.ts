// Máscara de dinheiro estilo "calculadora de banco": dígitos digitados
// entram da direita, sempre como centavos — o usuário nunca digita vírgula
// nem ponto, então não tem como ficar "bagunçado" ou ambíguo entre milhar e
// decimal. Ex.: digitar 2,0,0,0,0,0 mostra 0,02 -> 0,20 -> 2,00 -> 20,00 ->
// 200,00 -> 2.000,00.
export function centsFromMaskInput(raw: string): number {
  const digits = (raw || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 12); // até R$ 9.999.999.999,99
  return digits ? parseInt(digits, 10) : 0;
}

export function maskFromCents(cents: number): string {
  if (!cents) return '';
  return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function centsToReais(cents?: number): string {
  if (!cents) return '—';
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Para cálculos em que zero é um valor real (ex.: entrada/saldo do simulador),
// não deve ser confundido com campo ausente e exibido como travessão.
export function formatCentsBR(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Exibição de preço "legado": imóveis antigos guardaram o preço como texto
// livre (ex.: "5,000,000", "400000", "1.200.000"). Normaliza pra R$ pt-BR na
// hora de mostrar. Preços já formatados (contêm "R$") passam direto.
export function formatPriceDisplay(raw?: string): string {
  const s = (raw || '').trim();
  if (!s) return '—';
  if (/r\$/i.test(s)) return s;                          // já formatado (máscara/IA)
  const hasCents = /,\d{2}$/.test(s.replace(/\s/g, '')); // vírgula decimal no fim = centavos
  const digits = s.replace(/[^\d]/g, '');
  if (!digits) return s;
  const value = hasCents ? parseInt(digits, 10) / 100 : parseInt(digits, 10);
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  });
}
