export type PasswordResetCandidate = {
  id: string;
  userId: string;
  expiresAt: string;
};

type PasswordResetOps = {
  findCandidate: (token: string) => Promise<PasswordResetCandidate | null>;
  claimToken: (candidateId: string, token: string, nowIso: string) => Promise<boolean>;
  updatePassword: (userId: string, newPassword: string) => Promise<void>;
  restoreToken: (candidate: PasswordResetCandidate, token: string) => Promise<void>;
  reportRestoreFailure?: (error: unknown) => void;
};

export class PasswordResetTokenError extends Error {
  constructor(public readonly kind: "invalid" | "expired") {
    super(kind === "expired" ? "PASSWORD_RESET_TOKEN_EXPIRED" : "PASSWORD_RESET_TOKEN_INVALID");
    this.name = "PasswordResetTokenError";
  }
}

export async function executePasswordReset(
  input: { token: string; newPassword: string; now: Date },
  ops: PasswordResetOps,
): Promise<void> {
  const candidate = await ops.findCandidate(input.token);
  if (!candidate) throw new PasswordResetTokenError("invalid");

  const expiresAtMs = Date.parse(candidate.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= input.now.getTime()) {
    throw new PasswordResetTokenError("expired");
  }

  // O UPDATE condicional é o ponto de serialização: somente uma requisição
  // consegue trocar o token por NULL e prosseguir para alterar a senha.
  const claimed = await ops.claimToken(candidate.id, input.token, input.now.toISOString());
  if (!claimed) throw new PasswordResetTokenError("invalid");

  try {
    await ops.updatePassword(candidate.userId, input.newPassword);
  } catch (error) {
    // Se o Auth falhar, devolve ao usuário a possibilidade de tentar de novo.
    // A implementação só restaura quando reset_token ainda é NULL, para nunca
    // sobrescrever um token novo emitido simultaneamente pelo forgot-password.
    try {
      await ops.restoreToken(candidate, input.token);
    } catch (restoreError) {
      ops.reportRestoreFailure?.(restoreError);
    }
    throw error;
  }
}
