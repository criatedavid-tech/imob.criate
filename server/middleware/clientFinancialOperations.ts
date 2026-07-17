import type { NextFunction, Request, Response } from "express";
import { CLIENT_FINANCIAL_OPERATIONS_ENABLED } from "../config";

// Trava de produto para cobranças dos clientes da imobiliária/incorporadora.
// Mantém leitura de histórico e billing da assinatura do ImobiFlow intactos.
export function requireClientFinancialOperations(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!CLIENT_FINANCIAL_OPERATIONS_ENABLED) {
    return res.status(403).json({
      error: "As cobranças de clientes estão desativadas. Registre o pagamento fora do ImobiFlow.",
      code: "CLIENT_FINANCIAL_OPERATIONS_DISABLED",
    });
  }
  next();
}
