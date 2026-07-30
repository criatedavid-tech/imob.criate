import assert from "node:assert/strict";
import test from "node:test";
import { compensateInviteAcceptanceFailure } from "../server/services/inviteAcceptance";

test("libera o convite quando a criação do usuário falha", async () => {
  const calls: string[] = [];

  await compensateInviteAcceptanceFailure(
    { code: "invite", createdUserId: null, membershipCreated: false },
    {
      deleteCreatedUser: async (id) => { calls.push(`delete:${id}`); },
      releaseInvite: async (code) => { calls.push(`release:${code}`); },
    },
  );

  assert.deepEqual(calls, ["release:invite"]);
});

test("remove usuário órfão antes de liberar o convite", async () => {
  const calls: string[] = [];

  await compensateInviteAcceptanceFailure(
    { code: "invite", createdUserId: "user-1", membershipCreated: false },
    {
      deleteCreatedUser: async (id) => { calls.push(`delete:${id}`); },
      releaseInvite: async (code) => { calls.push(`release:${code}`); },
    },
  );

  assert.deepEqual(calls, ["delete:user-1", "release:invite"]);
});

test("não libera o convite se a remoção do usuário órfão falhar", async () => {
  let released = false;

  await assert.rejects(() => compensateInviteAcceptanceFailure(
    { code: "invite", createdUserId: "user-1", membershipCreated: false },
    {
      deleteCreatedUser: async () => { throw new Error("delete failed"); },
      releaseInvite: async () => { released = true; },
    },
  ), /delete failed/);

  assert.equal(released, false);
});

test("não desfaz aceite depois que o vínculo com a equipe existe", async () => {
  const calls: string[] = [];

  await compensateInviteAcceptanceFailure(
    { code: "invite", createdUserId: "user-1", membershipCreated: true },
    {
      deleteCreatedUser: async (id) => { calls.push(`delete:${id}`); },
      releaseInvite: async (code) => { calls.push(`release:${code}`); },
    },
  );

  assert.deepEqual(calls, []);
});
