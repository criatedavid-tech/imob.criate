import assert from "node:assert/strict";
import test from "node:test";
import { isValidPublicResetToken } from "../server/security/publicResetToken";
import {
  executePasswordReset,
  PasswordResetTokenError,
  type PasswordResetCandidate,
} from "../server/services/passwordReset";

const TOKEN = "a".repeat(64);
const CANDIDATE: PasswordResetCandidate = {
  id: "broker-1",
  userId: "user-1",
  expiresAt: "2026-07-30T15:15:00.000Z",
};
const NOW = new Date("2026-07-30T15:00:00.000Z");

test("token público de redefinição aceita somente 64 caracteres hexadecimais", () => {
  assert.equal(isValidPublicResetToken(TOKEN), true);
  for (const invalid of [TOKEN.toUpperCase(), "a".repeat(63), "a".repeat(65), "' OR 1=1--", ""]) {
    assert.equal(isValidPublicResetToken(invalid), false, invalid.slice(0, 80));
  }
});

test("reivindica o token antes de atualizar a senha", async () => {
  const calls: string[] = [];
  await executePasswordReset(
    { token: TOKEN, newPassword: "nova-senha", now: NOW },
    {
      findCandidate: async () => { calls.push("find"); return CANDIDATE; },
      claimToken: async () => { calls.push("claim"); return true; },
      updatePassword: async () => { calls.push("update"); },
      restoreToken: async () => { calls.push("restore"); },
    },
  );
  assert.deepEqual(calls, ["find", "claim", "update"]);
});

test("rejeita token inexistente, expirado ou já reivindicado", async () => {
  const base = {
    updatePassword: async () => {},
    restoreToken: async () => {},
  };

  await assert.rejects(
    () => executePasswordReset(
      { token: TOKEN, newPassword: "nova-senha", now: NOW },
      { ...base, findCandidate: async () => null, claimToken: async () => true },
    ),
    (error: any) => error instanceof PasswordResetTokenError && error.kind === "invalid",
  );

  await assert.rejects(
    () => executePasswordReset(
      { token: TOKEN, newPassword: "nova-senha", now: NOW },
      {
        ...base,
        findCandidate: async () => ({ ...CANDIDATE, expiresAt: NOW.toISOString() }),
        claimToken: async () => true,
      },
    ),
    (error: any) => error instanceof PasswordResetTokenError && error.kind === "expired",
  );

  await assert.rejects(
    () => executePasswordReset(
      { token: TOKEN, newPassword: "nova-senha", now: NOW },
      { ...base, findCandidate: async () => CANDIDATE, claimToken: async () => false },
    ),
    (error: any) => error instanceof PasswordResetTokenError && error.kind === "invalid",
  );
});

test("restaura o token quando a atualização no Auth falha", async () => {
  const calls: string[] = [];
  await assert.rejects(() => executePasswordReset(
    { token: TOKEN, newPassword: "nova-senha", now: NOW },
    {
      findCandidate: async () => CANDIDATE,
      claimToken: async () => true,
      updatePassword: async () => { calls.push("update"); throw new Error("auth failed"); },
      restoreToken: async () => { calls.push("restore"); },
    },
  ), /auth failed/);
  assert.deepEqual(calls, ["update", "restore"]);
});

test("preserva o erro original e reporta se a restauração também falhar", async () => {
  const reported: unknown[] = [];
  await assert.rejects(() => executePasswordReset(
    { token: TOKEN, newPassword: "nova-senha", now: NOW },
    {
      findCandidate: async () => CANDIDATE,
      claimToken: async () => true,
      updatePassword: async () => { throw new Error("auth failed"); },
      restoreToken: async () => { throw new Error("restore failed"); },
      reportRestoreFailure: (error) => { reported.push(error); },
    },
  ), /auth failed/);
  assert.equal(reported.length, 1);
  assert.match(String(reported[0]), /restore failed/);
});
