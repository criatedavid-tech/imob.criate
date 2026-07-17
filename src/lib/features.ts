// Deve permanecer alinhada com CLIENT_FINANCIAL_OPERATIONS_ENABLED no backend.
// O padrão seguro é desligado; habilitar exige opt-in explícito nos dois lados.
export const CLIENT_FINANCIAL_OPERATIONS_ENABLED =
  (import.meta as any).env.VITE_CLIENT_FINANCIAL_OPERATIONS_ENABLED === "true";
