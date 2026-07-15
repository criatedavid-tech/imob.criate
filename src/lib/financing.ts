export type FinancingEntry =
  | { mode: 'percent'; percent: number }
  | { mode: 'amount'; amountCents: number };

export interface FinancingSimulation {
  priceCents: number;
  entryCents: number;
  financedCents: number;
  installmentCount: number;
  regularInstallmentCents: number;
  finalInstallmentCents: number;
}

// Simulação simples, sem juros: preço - entrada = saldo, dividido em parcelas.
// O arredondamento acontece em centavos; qualquer resto vai apenas para a última
// parcela, garantindo que entrada + parcelas fechem exatamente o preço da unidade.
export function simulateFinancing(
  priceCents: number,
  entry: FinancingEntry,
  installmentCount: number,
): FinancingSimulation | null {
  if (!Number.isSafeInteger(priceCents) || priceCents <= 0) return null;
  if (!Number.isSafeInteger(installmentCount) || installmentCount < 1 || installmentCount > 120) return null;

  let entryCents: number;
  if (entry.mode === 'percent') {
    if (!Number.isFinite(entry.percent) || entry.percent < 0 || entry.percent > 100) return null;
    entryCents = Math.round(priceCents * entry.percent / 100);
  } else {
    if (!Number.isSafeInteger(entry.amountCents) || entry.amountCents < 0 || entry.amountCents > priceCents) return null;
    entryCents = entry.amountCents;
  }

  const financedCents = priceCents - entryCents;
  const regularInstallmentCents = Math.floor(financedCents / installmentCount);
  const finalInstallmentCents = regularInstallmentCents + (financedCents % installmentCount);

  return {
    priceCents,
    entryCents,
    financedCents,
    installmentCount,
    regularInstallmentCents,
    finalInstallmentCents,
  };
}
