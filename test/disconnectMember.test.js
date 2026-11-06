const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits: P } = require('discord.js');
const { disconnectMember } = require('../src/disconnectMember');
process.env.TARS_MODERATOR_ROLE_IDS = 'allowed-role';

function fixture(overrides = {}) {
  const replies = [], requests = [], actions = [], logs = [];
  const actor = { id: '1', roles: { cache: new Map([['role', { id: overrides.roleId || 'allowed-role', name: 'Sigma' }]]),
    highest: { comparePositionTo: () => overrides.hierarchy ?? 1 } } };
  actor.roles.cache.some = fn => [...actor.roles.cache.values()].some(fn);
  const target = { id: '2', manageable: overrides.manageable ?? true, user: { username: 'target' }, roles: { highest: {} },
    voice: { channelId: overrides.disconnected ? null : 'voice', disconnect: async reason => actions.push(reason) } };
  const me = { id: 'bot' };
  const channel = { id: 'voice', permissionsFor: member => ({ has: permission => {
    assert.equal(permission, P.MoveMembers);
    return member === actor ? overrides.actorPermission ?? true : member === me && (overrides.botPermission ?? true);
  } }) };
  const guild = { id: 'g', ownerId: overrides.ownerId || 'owner', members: {
    fetch: async ({ user, force }) => {
      assert.equal(force, true); requests.push(user);
      if (user === actor.id) return actor;
      if (overrides.fetchError) throw overrides.fetchError;
      return target;
    }, fetchMe: async ({ force }) => { assert.equal(force, true); return me; },
  }, channels: { fetch: async (id, { force }) => { assert.equal(id, 'voice'); assert.equal(force, true); return channel; } } };
  const ctx = { guild, user: { id: '1' }, reply: async text => replies.push(text) };
  return { replies, requests, actions, logs, actor, target, ctx,
    run: (text = 'saca a <@2>') => disconnectMember(ctx, text, (...args) => logs.push(args)) };
}

test('disconnect requires the configured role ID, not a duplicated privileged role name', async () => {
  const f = fixture({ roleId: 'untrusted-same-name' }); await f.run();
  assert.equal(f.actions.length, 0); assert.deepEqual(f.requests, ['1']); assert.match(f.replies[0], /rango suficiente/);
});

test('disconnect requires the native channel permission for actor and bot', async () => {
  for (const denied of ['actorPermission', 'botPermission']) {
    const f = fixture({ [denied]: false }); await f.run();
    assert.equal(f.actions.length, 0); assert.equal(f.logs.length, 0);
    assert.match(f.replies[0], denied === 'actorPermission' ? /Mover miembros/ : /permisos o jerarquía/);
  }
});

test('disconnect denies equal or higher hierarchy, unmanageable targets, oneself and the guild owner', async () => {
  for (const settings of [{ hierarchy: 0 }, { hierarchy: -1 }, { manageable: false }, { ownerId: '2' }]) {
    const f = fixture(settings); await f.run(); assert.equal(f.actions.length, 0);
  }
  const self = fixture(); await self.run('saca a <@1>'); assert.equal(self.actions.length, 0);
});

test('owner bypasses configured moderator roles and actor hierarchy but still needs bot permissions', async () => {
  const f = fixture({ ownerId: '1', roleId: 'no-role', hierarchy: -1 }); await f.run();
  assert.deepEqual(f.actions, ['Solicitado por 1']);
  assert.equal(f.logs[0][0], 'desconexion'); assert.equal(f.logs[0][1].objetivo_id, '2');
  const denied = fixture({ ownerId: '1', botPermission: false }); await denied.run(); assert.equal(denied.actions.length, 0);
});

test('valid disconnect refreshes all permission-bearing resources and confirms only after success', async () => {
  const f = fixture(); await f.run();
  assert.deepEqual(f.requests, ['1', '2']); assert.equal(f.actions.length, 1);
  assert.equal(f.replies[0], 'target desconectado del canal de voz.');
  const failed = fixture(); failed.target.voice.disconnect = async () => { throw Object.assign(Error('denied'), { code: 50013 }); };
  await assert.rejects(failed.run(), { code: 50013 }); assert.equal(failed.logs.length, 0); assert.equal(failed.replies.length, 0);
});

test('unknown users, absent voice sessions and ambiguous targets never invoke a disconnect', async () => {
  const missing = fixture({ fetchError: Object.assign(Error('Unknown member'), { code: 10007 }) });
  await missing.run(); assert.match(missing.replies[0], /No encontré/);
  const absent = fixture({ disconnected: true }); await absent.run(); assert.match(absent.replies[0], /no está en ningún canal/);
  for (const text of ['saca a target', 'saca a <@2> y <@3>']) {
    const f = fixture(); await f.run(text); assert.deepEqual(f.requests, ['1']); assert.equal(f.actions.length, 0);
  }
  const unavailable = fixture({ fetchError: Error('network failed') }); await assert.rejects(unavailable.run(), /network failed/);
});
