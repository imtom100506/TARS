const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function fixture({ missing = false, detected = false } = {}) {
  const files = [], engines = [], streams = [];
  class KeywordSpotter {
    constructor(config) { this.config = config; this.resets = 0; engines.push(this); }
    createStream() {
      const stream = { samples: [], pending: false, acceptWaveform(frame) { this.samples.push(frame); this.pending = true; } };
      streams.push(stream); return stream;
    }
    isReady(stream) { return stream.pending; }
    decode(stream) { stream.pending = false; }
    getResult() { return { keyword: detected ? 'hey tars' : '' }; }
    reset() { this.resets++; }
  }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/localSpeech.js'), 'utf8'), {
    module, __dirname: path.join(__dirname, '../src'), process: { env: {} }, Float32Array,
    require(name) {
      if (name === 'node:fs') return { existsSync(file) { files.push(file); return !missing; } };
      if (name === 'node:path') return path;
      if (name === 'sherpa-onnx-node') return { KeywordSpotter };
      throw Error('Unexpected dependency: ' + name);
    },
  });
  return { api: module.exports, files, engines, streams };
}

test('disabled wake detection does not load models or native libraries', () => {
  const f = fixture(); assert.equal(f.api.createWakeFactory({}), null);
  assert.equal(f.files.length, 0); assert.equal(f.engines.length, 0);
});

test('missing model files fail before constructing a native detector', () => {
  const f = fixture({ missing: true });
  assert.throws(() => f.api.createWakeFactory({ TARS_WAKE_ENABLED: 'true' })(), /Faltan modelos locales/);
  assert.throws(() => f.api.ttsConfig(), /Faltan modelos locales/);
  assert.equal(f.engines.length, 0);
});

test('wake streams remain independent, normalize PCM and stop after release', () => {
  const f = fixture(); const factory = f.api.createWakeFactory({ TARS_WAKE_ENABLED: 'true' });
  const first = factory(), second = factory();
  assert.equal(f.engines.length, 1); assert.equal(f.streams.length, 2);
  assert.equal(first.process(Int16Array.from([-32768, 0, 16384])), -1);
  assert.deepEqual([...f.streams[0].samples[0].samples], [-1, 0, 0.5]);
  assert.equal(f.streams[0].samples[0].sampleRate, 16000);
  assert.equal(f.streams[1].samples.length, 0);
  first.release(); first.release(); assert.equal(first.process(new Int16Array(1280)), -1);
  assert.equal(f.streams[0].samples.length, 1);
  second.release(); factory.dispose(); factory(); assert.equal(f.engines.length, 2);
});

test('keyword detection resets its stream and uses bounded CPU configuration', () => {
  const f = fixture({ detected: true }); const detector = f.api.createWakeFactory({ TARS_WAKE_ENABLED: 'true' })();
  assert.equal(detector.process(new Int16Array(1280)), 0);
  assert.equal(f.engines[0].resets, 1);
  const config = f.engines[0].config;
  assert.equal(config.modelConfig.numThreads, 1); assert.equal(config.modelConfig.provider, 'cpu');
  assert.match(config.keywordsFile, /hey-tars\.txt$/);
  const tts = f.api.ttsConfig();
  assert.equal(tts.model.numThreads, 1); assert.equal(tts.maxNumSentences, 1);
  assert.ok(f.files.every(file => file.startsWith(path.resolve(__dirname, '../models') + path.sep)));
});
