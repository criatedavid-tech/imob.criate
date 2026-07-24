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

// Converte os preços textuais legados para centavos ao preencher o formulário
// de edição. No legado existem valores com separadores de milhar em ambos os
// formatos ("5,000,000" e "1.200.000") e valores pt-BR com centavos
// ("R$ 1.000.000,00"). Uma vírgula só é decimal quando é única e aparece no
// final; múltiplas vírgulas são separadores de milhar.
export function parseLegacyPriceToCents(raw?: string): number {
  const compact = (raw || '').trim().replace(/\s/g, '');
  if (!compact) return 0;

  const commaCount = (compact.match(/,/g) || []).length;
  const dotCount = (compact.match(/\./g) || []).length;
  const decimalComma = commaCount === 1 && /,\d{1,2}$/.test(compact);
  // Aceita também o formato internacional "5,000.00", mas mantém "5.00"
  // compatível com o legado pt-BR, onde o ponto era separador de milhar.
  const decimalDot = !decimalComma && commaCount > 0 && dotCount === 1 && /\.\d{1,2}$/.test(compact);

  const decimalSeparator = decimalComma ? ',' : decimalDot ? '.' : null;
  if (decimalSeparator) {
    const separatorIndex = compact.lastIndexOf(decimalSeparator);
    const reaisDigits = compact.slice(0, separatorIndex).replace(/\D/g, '').slice(0, 10);
    const centsDigits = compact.slice(separatorIndex + 1).replace(/\D/g, '').padEnd(2, '0').slice(0, 2);
    const reais = reaisDigits ? parseInt(reaisDigits, 10) : 0;
    const cents = centsDigits ? parseInt(centsDigits, 10) : 0;
    const total = reais * 100 + cents;
    return Number.isSafeInteger(total) ? total : 0;
  }

  const reaisDigits = compact.replace(/\D/g, '').slice(0, 10);
  if (!reaisDigits) return 0;
  const total = parseInt(reaisDigits, 10) * 100;
  return Number.isSafeInteger(total) ? total : 0;
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
