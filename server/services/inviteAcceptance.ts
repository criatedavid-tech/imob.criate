export type InviteAcceptanceCompensation = {
  code: string;
  createdUserId: string | null;
  membershipCreated: boolean;
};

type InviteAcceptanceCompensationOps = {
  deleteCreatedUser: (userId: string) => Promise<void>;
  releaseInvite: (code: string) => Promise<void>;
};

export async function compensateInviteAcceptanceFailure(
  state: InviteAcceptanceCompensation,
  ops: InviteAcceptanceCompensationOps,
): Promise<void> {
  // Depois que o vínculo existe, o aceite já é válido e não deve ser desfeito
  // por falhas auxiliares (metadados, provisionamento ou login automático).
  if (state.membershipCreated) return;

  // Nunca libera o convite se não conseguiu remover o usuário recém-criado:
  // isso impediria uma segunda tentativa de criar outro vínculo concorrente.
  if (state.createdUserId) {
    await ops.deleteCreatedUser(state.createdUserId);
  }

  await ops.releaseInvite(state.code);
}
