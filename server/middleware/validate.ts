import { ZodType } from "zod";
import type { Request, Response, NextFunction } from "express";

// Valida req.body contra um schema zod antes da rota rodar. Em caso de
// falha, corta com 400 e uma mensagem específica por campo — em vez de cada
// rota reimplementar "if (!campo) return res.status(400)..." à mão. Em caso
// de sucesso, substitui req.body pelo resultado parseado (tipado, com
// qualquer campo não declarado no schema descartado).
export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: "Dados inválidos.",
        details: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    req.body = result.data;
    next();
  };
}
