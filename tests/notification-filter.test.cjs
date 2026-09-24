const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function evaluate(source, requireModule, globals = {}) {
  const context = { exports: {}, require: requireModule, ...globals };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return context.exports;
}
const source = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const load = (file, requireModule) => evaluate(source(file), requireModule);

function store(settings = new Map()) {
  return load('app/native/notification-sources.ts', () => ({
    getStringSetting: (key, fallback) => settings.get(key) ?? fallback,
    setStringSetting: (key, value) => settings.set(key, value),
  }));
}
const mail = { packageName: 'com.mail', appName: 'Mail' };

test('sources default on and retain per-package choices and names across restart and rediscovery', () => {
  const settings = new Map();
  let prefs = store(settings);
  assert.equal(prefs.shouldShowNotificationOnGlasses(mail.packageName), true);
  prefs.rememberNotificationSources([mail, mail, { packageName: 'com.other', appName: 'Mail' }]);
  assert.equal(prefs.readNotificationSources().length, 2);
  prefs.setNotificationSourceEnabled({ ...mail, text: 'private notification content' }, false);
  assert.ok(!Array.from(settings.values()).join('').includes('private notification content'));
  prefs = store(settings);
  prefs.rememberNotificationSources([{ ...mail, appName: 'Renamed Mail' }, { packageName: 'com.new', appName: '' }]);
  assert.equal(prefs.shouldShowNotificationOnGlasses(mail.packageName), false);
  assert.equal(prefs.shouldShowNotificationOnGlasses('com.other'), true);
  assert.equal(prefs.shouldShowNotificationOnGlasses('com.new'), true);
  assert.equal(prefs.readNotificationSources().find((s) => s.packageName === mail.packageName).appName, 'Renamed Mail');
  prefs.setNotificationSourceEnabled(mail, true);
  assert.equal(store(settings).shouldShowNotificationOnGlasses(mail.packageName), true);
});

test('invalid saved source data falls back to enabled', () => {
  for (const raw of ['invalid', '{}', '[null, {}, {"packageName": 1}]']) {
    assert.equal(store(new Map([['notifications.sources', raw]])).shouldShowNotificationOnGlasses('com.mail'), true);
  }
});

function ui(fontSize = 12) {
  const prefs = store();
  let active = [{ ...mail, key: 'key', title: 'Message', text: 'Hello', bigText: '', lines: [], actions: [], postTime: 0 }];
  let dismissals = 0;
  let closes = 0;
  const textwrap = load('app/graphics/textwrap.ts');
  const graphics = load('app/graphics/image.ts', () => textwrap);
  const { BdfFont } = load('app/graphics/bdffont.ts', () => ({}));
  const font = BdfFont.parse(source(`app/fonts/terminus/ter-u${fontSize}n.bdf`));
  class RecordingImage extends graphics.GrayImage {
    texts = [];
    drawText(font, x, y, text, value) {
      this.texts.push({ x, y, text });
      super.drawText(font, x, y, text, value);
    }
  }
  const native = {
    ALL_NOTIFICATIONS: 0x7fffffff,
    readActiveNotifications: () => { prefs.rememberNotificationSources(active); return active; },
    dismissNotification: () => { dismissals++; active = []; return true; },
    readNotificationIconByKey: () => ({ icon: null, stale: false }),
  };
  const dependencies = {
    '../graphics/image': { ...graphics, GrayImage: RecordingImage },
    '../graphics/textwrap': textwrap,
    '../graphics/ui-fonts': { getDefaultSmallFont: () => font },
    '../util/numeric-util': { clamp: (n, lo, hi) => Math.max(lo, Math.min(hi, n)) },
    '~/util/numeric-util': { clamp: (n, lo, hi) => Math.max(lo, Math.min(hi, n)) },
    '~/util/date-util': { formatRelativeTime: () => '' },
    '../native/notification-icons': native,
    '../native/notification-sources': prefs,
    '../native/notification-access': { isNotificationListenerEnabled: () => true },
    '../util/render-freshness': { renderPassAllowsStaleData: () => false },
    './metrics': load('app/ui/metrics.ts'),
    './notification-text': load('app/ui/notification-text.ts', () => ({})),
    './gestures': {},
  };
  const requireModule = (name) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  };
  dependencies['./menu'] = load('app/ui/menu.ts', requireModule);
  const { SingleNotificationLayer } = load('app/ui/notifications.ts', requireModule);
  const { NotificationFilterLayer } = load('app/ui/notification-filter.ts', requireModule);
  const { NotificationsListLayer } = load('app/ui/notifications.ts', requireModule);
  const ctx = { stack: { getBaseSize: () => ({ width: 540, height: 224 }), isFocused: () => true, pop: () => closes++ } };
  const popup = new SingleNotificationLayer('key', { origin: 'new-notification-modal', closeModal: () => closes++ });
  const listCard = new SingleNotificationLayer('key', { origin: 'notifications-list', closeModal: () => closes++ });
  const list = new NotificationsListLayer();
  const filter = new NotificationFilterLayer();
  const paint = (layer) => layer.paint(ctx, () => new RecordingImage(540, 224));
  const input = (layer, type) => layer.handleInput({ type }, ctx);
  return { prefs, popup, listCard, list, filter, paint, input, active: (value) => { active = value; },
    dismissals: () => dismissals, closes: () => closes };
}

test('popup dismisses before confirmation; confirming disables the source even after the notification disappears', async () => {
  const app = ui();
  await app.input(app.popup, 'scroll-down');
  await app.input(app.popup, 'scroll-down');
  await app.input(app.popup, 'click');
  assert.equal(app.dismissals(), 1);
  assert.equal(app.closes(), 0);
  assert.equal(app.prefs.shouldShowNotificationOnGlasses(mail.packageName), true);
  assert.ok(app.paint(app.popup).texts.some(({ text }) => text.includes('Mail')));
  assert.equal(app.closes(), 0);
  await app.input(app.popup, 'scroll-down');
  await app.input(app.popup, 'click');
  assert.equal(app.prefs.shouldShowNotificationOnGlasses(mail.packageName), false);
  assert.equal(app.closes(), 1);
});

test('cancel and back dismiss the popup without changing source preferences', async () => {
  for (const cancel of ['click', 'double-click']) {
    const app = ui();
    await app.input(app.popup, 'scroll-down');
    await app.input(app.popup, 'scroll-down');
    await app.input(app.popup, 'click');
    await app.input(app.popup, cancel);
    assert.equal(app.dismissals(), 1);
    assert.equal(app.closes(), 1);
    assert.equal(app.prefs.shouldShowNotificationOnGlasses(mail.packageName), true);
  }
});

test('filter toggles persist after notifications disappear and discovers new sources while open', async () => {
  const app = ui();
  app.paint(app.filter);
  await app.input(app.filter, 'click');
  assert.equal(app.prefs.shouldShowNotificationOnGlasses(mail.packageName), false);
  app.active([{ packageName: 'com.alpha', appName: 'Alpha' }]);
  const image = app.paint(app.filter);
  assert.ok(image.texts.some(({ text }) => text === 'Alpha'));
  assert.ok(image.texts.some(({ text }) => text === 'Mail'));
  // A source inserted before the selection must not move the toggle to another app.
  await app.input(app.filter, 'click');
  assert.equal(app.prefs.shouldShowNotificationOnGlasses(mail.packageName), true);
  assert.equal(app.prefs.shouldShowNotificationOnGlasses('com.alpha'), true);
});

test('popup action wraps fully and stays visible with small and large fonts', async () => {
  for (const size of [12, 20]) {
    const app = ui(size);
    await app.input(app.popup, 'scroll-down');
    await app.input(app.popup, 'scroll-down');
    const image = app.paint(app.popup);
    assert.ok(image.texts.map(({ text }) => text).join(' ').includes("Don't show on glasses again"));
    assert.ok(image.texts.every(({ y }) => y >= 0 && y < image.height));
  }
});

test('controller filters before waking or opening a popup, and still refreshes the tray', async () => {
  const file = ts.createSourceFile('controller.ts', source('app/g2/dashboard-controller.ts'), ts.ScriptTarget.Latest, true);
  const controller = file.statements.find((node) => ts.isClassDeclaration(node) && node.name.text === 'DashboardController');
  const handler = controller.members.find((node) => node.name?.getText(file) === 'handleAndroidNotificationPosted');
  const prefs = store();
  let wakes = 0, popups = 0, renders = 0;
  const { Harness } = evaluate(`export class Harness { ${handler.getText(file)} }`, null, {
    ALL_NOTIFICATIONS: 0x7fffffff,
    readActiveNotifications: () => [{ ...mail, key: 'key' }],
    shouldShowNotificationOnGlasses: prefs.shouldShowNotificationOnGlasses,
    shell: { isScreenOn: () => false, wake: () => { wakes++; return true; }, openNotificationModal: () => popups++ },
  });
  const instance = new Harness();
  instance.requestShellRender = () => renders++;
  instance.appendLog = () => {};
  prefs.setNotificationSourceEnabled(mail, false);
  await instance.handleAndroidNotificationPosted('key');
  await instance.handleAndroidNotificationPosted('gone');
  assert.equal(wakes, 0);
  assert.equal(popups, 0);
  assert.equal(renders, 2);
  prefs.setNotificationSourceEnabled(mail, true);
  await instance.handleAndroidNotificationPosted('key');
  assert.equal(wakes, 1);
  assert.equal(popups, 1);
});

// A notification is shown on two surfaces, and the bug these cover is the two
// surfaces disagreeing about it. So each case paints BOTH and compares them,
// rather than asserting on the card alone -- an assertion on one surface cannot
// see a disagreement, which is how the placeholder survived in the first place.
const notification = (fields) => ({
  ...mail, key: 'key', title: '', text: '', bigText: '', subText: '', infoText: '',
  summaryText: '', lines: [], actions: [], postTime: 0, isGroupSummary: false, ...fields,
});
const drawn = (app, layer) => app.paint(layer).texts.map(({ text }) => text);
const countOf = (texts, needle) => texts.filter((text) => text.includes(needle)).length;

for (const [name, fields, content] of [
  ['only body text', { text: 'Garage unlocked' }, 'Garage unlocked'],
  ['only summary text', { summaryText: '8:25 AM' }, '8:25 AM'],
  ['only inbox lines', { lines: ['Alice: hi', 'Bob: yo'] }, 'Alice: hi'],
  ['big text longer than the text', { text: 'short', bigText: 'the longer form' }, 'the longer form'],
]) {
  test(`a notification carrying ${name} reads the same on the card as in the list`, () => {
    const app = ui();
    app.active([notification(fields)]);
    const card = drawn(app, app.popup);
    const list = drawn(app, app.list);

    // Neither surface may fall back to a placeholder while the notification has
    // something to say.
    assert.ok(!card.some((text) => text.includes('untitled')), `card: ${card.join(' | ')}`);
    assert.ok(!list.some((text) => text.includes('untitled')), `list: ${list.join(' | ')}`);

    // Both show the content, and the card shows it exactly once: the headline
    // falls back to the body, so drawing the body again would repeat it.
    assert.ok(card.some((text) => text.includes(content)), `card: ${card.join(' | ')}`);
    assert.ok(list.some((text) => text.includes(content)), `list: ${list.join(' | ')}`);
    assert.equal(countOf(card, content), 1, `card repeated the headline: ${card.join(' | ')}`);
  });
}

test('a notification with nothing in it names its sender once, not twice', () => {
  const app = ui();
  app.active([notification({})]);
  const card = drawn(app, app.popup);
  // The card already prints the sender on its own line, so a headline falling
  // back to the app name would say the same word twice and read as a glitch.
  assert.equal(countOf(card, 'Mail'), 1, `card: ${card.join(' | ')}`);
});

test('the ignore-source option is offered from the popup but not from the list', () => {
  const app = ui();
  const offered = (layer) => drawn(app, layer).some((text) => text.includes("Don't show"));
  assert.equal(offered(app.popup), true);
  // Opening the same notification from the list offers no way to silence its
  // app, so that choice is reachable only by catching the popup while it is up.
  assert.equal(offered(app.listCard), false);
});
