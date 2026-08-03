export type PropertyPurpose = "venda" | "aluguel" | "ambos";

const DETAILS_SEPARATOR = "---DETALHES-GERADOS---";

// A finalidade ainda fica armazenada no bloco JSON anexado à descrição.
// Extraia somente o valor conhecido para que texto livre do anúncio nunca
// seja tratado como instrução ou usado para inferir venda/aluguel.
export function parsePropertyPurpose(description: unknown): PropertyPurpose {
  if (typeof description !== "string") return "venda";

  const separatorIndex = description.indexOf(DETAILS_SEPARATOR);
  if (separatorIndex < 0) return "venda";

  try {
    const details = JSON.parse(description.slice(separatorIndex + DETAILS_SEPARATOR.length).trim());
    const rawPurpose = typeof details?.finalidade === "string"
      ? details.finalidade.trim().toLocaleLowerCase("pt-BR")
      : "";

    if (rawPurpose === "aluguel" || rawPurpose === "locacao" || rawPurpose === "locação") {
      return "aluguel";
    }
    if (rawPurpose === "ambos") return "ambos";
    return "venda";
  } catch {
    return "venda";
  }
}
