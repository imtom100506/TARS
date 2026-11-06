const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Collection, ChannelType: T, PermissionFlagsBits: P } = require('discord.js');
const { activityVisibility, hasModeratorRole, canReadAudit } = require('../src/accessPolicy');
function fixture() {
  const member = { id: 'u', permissions: { has: () => true } };
  const channels = new Collection();
  function add(id, { publicChannel = true, readable = true, denied = false, type = T.GuildText, parentId, joined = false, manage = false } = {}) {
    const c = { id, guildId: 'g', type, parentId, isThread: () => [T.PublicThread, T.PrivateThread].includes(type),
      permissionOverwrites: { cache: new Collection(denied ? [['role', { deny: { has: bit => bit === P.ViewChannel } }]] : []) },
      permissionsFor: actor => ({ has: bit => bit === P.ManageThreads ? manage : actor === 'g' ? publicChannel : readable }),
      members: { fetch: async () => { if (!joined) throw Error('Not joined'); return { id: 'u' }; } },
    };
    channels.set(id, c); return c;
  }
  const g = { id: 'g', roles: { fetch: async () => new Collection() },
    members: { fetch: async options => { assert.equal(options.force, true); return member; } },
    channels: { fetch: async id => id ? channels.get(id) : channels, fetchActiveThreads: async () => ({ threads: new Collection() }) } };
  return { g, add, member };
}
test('visibility excludes private channels, explicit denied audiences, missing channels and stale snapshots', async () => {
  const f = fixture(); f.add('response'); const pub = f.add('public');
  const hidden = f.add('hidden', { publicChannel: false }); const denied = f.add('denied', { denied: true });
  const inaccessible = f.add('inaccessible', { readable: false });
  const visible = await activityVisibility(f.g, 'u', 'response');
  assert.equal(visible(pub), true); assert.equal(visible(hidden), false); assert.equal(visible(denied), false);
  assert.equal(visible(inaccessible), false); assert.equal(visible({ id: 'deleted' }), false);
  assert.equal(visible({ id: hidden.id, permissionsFor: () => ({ has: () => true }) }), false);
  const own = await activityVisibility(f.g, 'u', 'hidden'); assert.equal(own(hidden), true);
});
test('private threads cannot borrow the public parent permissions or disclose history outside their audience', async () => {
  const f = fixture(); f.add('response'); f.add('parent');
  const thread = f.add('secret', { type: T.PrivateThread, parentId: 'parent' });
  assert.equal((await activityVisibility(f.g, 'u', 'response'))(thread), false);
  assert.equal((await activityVisibility(f.g, 'u', 'secret'))(thread), false);
  f.add('secret', { type: T.PrivateThread, parentId: 'parent', joined: true });
  assert.equal((await activityVisibility(f.g, 'u', 'secret'))(thread), true);
  assert.equal((await activityVisibility(f.g, 'u', 'response'))(thread), false);
  const publicThread = f.add('normal', { type: T.PublicThread, parentId: 'parent' });
  assert.equal((await activityVisibility(f.g, 'u', 'response'))(publicThread), true);
});
test('authorization uses exact role IDs and refreshed audit permissions', async () => {
  const member = { roles: { cache: new Collection([['r', { id: 'r', name: 'Sigma' }]]) } };
  assert.equal(hasModeratorRole(member, 'g', { TARS_MODERATOR_ROLE_IDS: 'other' }), false);
  assert.equal(hasModeratorRole(member, 'g', { TARS_MODERATOR_ROLE_IDS: ' r ' }), true);
  const f = fixture(); assert.equal(await canReadAudit(f.g, 'u'), true);
  f.member.permissions.has = () => false; assert.equal(await canReadAudit(f.g, 'u'), false);
  assert.equal(await canReadAudit(f.g), false);
});
