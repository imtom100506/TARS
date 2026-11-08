const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { startRadarPresence } = require('../src/radarPresence.cjs');

const logger = {info(){}, warn(){}, error(){}};
test('RADAR remains optional when no token is configured', () => {
  class Forbidden { constructor(){ throw new Error('Should not construct client'); } }
  assert.equal(startRadarPresence({token:'', logger, ClientClass:Forbidden}),null);
});
test('RADAR logs in independently with no message or privileged intents', async () => {
  class FakeClient extends EventEmitter {
    constructor(options){ super(); this.options=options; }
    async login(token){this.token=token;}
    destroy(){this.stopped=true;}
  }
  const radar=startRadarPresence({token:'radar-test',logger,ClientClass:FakeClient});
  assert.equal(radar.client.token,'radar-test');
  assert.deepEqual(radar.client.options.intents,[]);
  assert.equal(radar.client.options.presence.status,'online');
  radar.stop(); assert.equal(radar.client.stopped,true);
});
test('RADAR authentication failure is caught without exposing the credential', async () => {
  const errors=[];
  class FailingClient extends EventEmitter { async login(){throw new Error('secret');} }
  startRadarPresence({token:'secret',logger:{...logger,error:msg=>errors.push(msg)},ClientClass:FailingClient});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(errors.length,1);
  assert.ok(!errors[0].includes('secret'));
});
