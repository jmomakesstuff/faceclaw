const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, deps, globals = {}) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, console, setTimeout, clearTimeout, ...globals, require(name) {
    assert.ok(name in deps, `Unexpected import ${name} in ${file}`);
    return deps[name];
  } });
  return exports;
}
const callbacks = (errors = []) => ({ onTextDelta() {}, onToolActivity() {}, onTurnDone() {}, onError(m) { errors.push(m); } });

/** The bridge client over a fake native websocket that records every frame the phone sends. */
function bridgeClient() {
  const sent = [];
  let listener = null;
  const com = { faceclaw: { app: {
    FaceclawWebSocketListener: class { constructor(handlers) { Object.assign(this, handlers); listener = this; } },
    FaceclawWebSocket: class { sendText(text) { sent.push(JSON.parse(text)); } close() {} },
  } } };
  const { AssistantBridgeClient } = load('app/assistant/bridge-client.ts', {
    './mcp-server': { AssistantMcpServer: class { handleMessage() {} sendToolsChanged() {} } },
    './tool-registry': { toolRegistry: { onToolsChanged: () => () => {} } },
  }, { com });
  const client = new AssistantBridgeClient();
  client.configure({ host: 'bridge.local', port: 8790, token: 't', deviceName: 'test', allowProactive: () => false });
  listener.onOpen();
  const ack = (extra) => listener.onTextMessage(JSON.stringify({ v: 1, chan: 'ctl', type: 'hello-ack', ...extra }));
  return { client, sent, ack, listener: () => listener, utterances: () => sent.filter((f) => f.type === 'utterance') };
}

test('the phone offers conversations and sends a conversationId only to a bridge that advertised them', () => {
  const env = bridgeClient();
  assert.deepEqual(env.sent[0].capabilities, ['chat', 'mcp', 'conversations']);
  env.ack({ capabilities: ['chat', 'mcp', 'conversations'] });
  assert.equal(env.client.supportsConversations(), true);
  env.client.sendUtterance('hello', {}, callbacks(), 'conv-1');
  assert.equal(env.utterances().at(-1).conversationId, 'conv-1');
  env.client.stop();
  assert.equal(env.client.supportsConversations(), false);
});

test('a bridge without the capability gets no conversationId, and the phone keeps one conversation', () => {
  const env = bridgeClient();
  env.ack({});
  assert.equal(env.client.isConnected(), true);
  assert.equal(env.client.supportsConversations(), false);
  env.client.sendUtterance('hello', {}, callbacks(), 'conv-1');
  assert.equal('conversationId' in env.utterances().at(-1), false);
  env.client.stop();
});

test('a lost connection forgets the capabilities, so a reconnect to another bridge starts clean', () => {
  const env = bridgeClient();
  env.ack({ capabilities: ['conversations'] });
  assert.equal(env.client.supportsConversations(), true);
  env.listener().onClosed(1006, '');
  assert.equal(env.client.supportsConversations(), false);
  env.client.stop();
});

test('each conversation sends its own id through the external backend', () => {
  const calls = [];
  const bridge = { sendUtterance(text, ctx, cbs, conversationId) {
    calls.push({ text, conversationId });
    cbs.onTurnDone({ stopReason: 'end_turn' });
    return { cancel() {} };
  } };
  const { AssistantSession } = load('app/assistant/session.ts', {
    '../prompts': { ASSISTANT_SYSTEM_PROMPT_BASE: '', buildAssistantSystemPrompt: () => '', describeAssistantContext: () => '' },
    './bridge-client': { assistantBridge: bridge },
    './direct-backend': { DirectAssistantBackend: class {} },
    './tool-registry': { toolRegistry: { listTools: () => [] } },
  });
  const { AssistantConversations } = load('app/assistant/conversations.ts', {
    './session': { AssistantSession },
    './models': { supportedAssistantModel: (value) => value, ASSISTANT_MODEL_VALUES: ['auto'] },
  });
  const store = new AssistantConversations(() => ({ kind: 'external', bridge: {} }), () => 'auto', () => {});
  const first = store.current().id;
  store.ensureSession().sendUtterance('in the first', {}, callbacks());
  assert.ok(store.create());
  const second = store.current().id;
  store.ensureSession().sendUtterance('in the second', {}, callbacks());
  assert.ok(store.select(first));
  store.ensureSession().sendUtterance('back in the first', {}, callbacks());
  assert.notEqual(first, second);
  assert.deepEqual(calls.map((c) => c.conversationId), [first, second, first]);
  // The bridge accepts only short plain ids; the phone's must always qualify.
  for (const id of [first, second]) assert.match(id, /^[A-Za-z0-9._-]{1,64}$/);
});
