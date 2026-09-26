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
  const graphics = require('../.test-build/app/graphics/image.js');
  const { BdfFont } = load('app/graphics/bdffont.ts', () => ({}));
  const font = BdfFont.parse(source(`app/fonts/terminus/ter-u${fontSize}n.bdf`));
  class RecordingImage extends graphics.GrayImage {
    texts = [];
    drawMenuSelection(source, x, y, ...args) {
      this.texts.push(...source.texts.map(t => ({ ...t, x: t.x + x, y: t.y + y })));
      super.drawMenuSelection(source, x, y, ...args);
    }
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
    './menu-highlight-motion': require('../.test-build/app/ui/menu-highlight-motion.js'), '../graphics/menu-scroll-list': require('../.test-build/app/graphics/menu-scroll-list.js'), './menu-scroll-motion': require('../.test-build/app/ui/menu-scroll-motion.js'), '../graphics/draw-expression': require('../.test-build/app/graphics/draw-expression.js'),
    './metrics': load('app/ui/metrics.ts'),
    './notification-text': load('app/ui/notification-text.ts', () => ({})),
    './gestures': {},
  };
  const requireModule = (name) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  };
  dependencies['./menu-core'] = load('app/ui/menu-core.ts', requireModule);
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
  const iconFetches = [];
  const { Harness } = evaluate(`export class Harness { ${handler.getText(file)} }`, null, {
    ALL_NOTIFICATIONS: 0x7fffffff,
    readActiveNotifications: () => [{ ...mail, key: 'key' }],
    shouldShowNotificationOnGlasses: prefs.shouldShowNotificationOnGlasses,
    readNotificationIconByKey: (key, allowStale) => { iconFetches.push([key, allowStale]); return { icon: null, stale: false }; },
    warmActiveNotificationIcons: () => {},
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
  // The icon is fetched before the card opens, and NOT in allow-stale mode: a
  // paint may decline to block on a cold icon, so warming it here is what stops
  // the card opening blank and popping an icon in a repaint later. Nothing is
  // fetched for a notification that was filtered out.
  assert.deepEqual(iconFetches, [['key', false]]);
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

test('a stale read still finds the icon after the caches are invalidated', () => {
  // Exercises the module rather than matching its source. Before the fix the
  // tray cache was EXPIRED (entries kept) while the keyed cache was DESTROYED,
  // so a paint running in allow-stale mode drew the previous tray icons and
  // nothing for the card -- the icon appeared, vanished for a frame, came back.
  let posted = null;
  const iconBytes = new Uint8Array(24 * 24).fill(200);
  const com = { faceclaw: { app: {
    FaceclawMediaNotificationListenerService: {
      getNotificationIconGrayForKey: () => iconBytes,
      getActiveNotificationIconGrays: () => iconBytes,
      getActiveNotificationsJson: () => '[]',
      addNotificationListener: () => {},
      removeNotificationListener: () => {},
    },
    FaceclawNotificationListener: function (handlers) { posted = handlers.onNotificationPosted; },
  } } };
  const mod = evaluate(source('app/native/notification-icons.ts'), (name) => {
    if (name.endsWith('image')) return { GrayImage: class { constructor(w, h) { this.pixels = new Uint8Array(w * h); } clone() { return this; } } };
    if (name.endsWith('frame-timings')) return { logCurrent: () => {}, spanCurrent: (_n, fn) => fn() };
    if (name.endsWith('array-util')) return { toUint8Array: (v) => v };
    if (name.endsWith('notification-sources')) return { rememberNotificationSources: () => {} };
    return {};
  }, { global: { isAndroid: true }, com, setTimeout });

  {
    // Warm it: a non-stale read fetches and caches.
    assert.ok(mod.readNotificationIconByKey('key', false).icon, 'expected a fetched icon');
    // Registering the listener is what gives us the invalidation hook.
    mod.onAndroidNotificationPosted(() => {});
    assert.ok(posted, 'expected the native listener to be registered');

    // A posted notification invalidates the caches.
    posted('key');

    // THE POINT: a paint that declines to block must still find the last icon.
    const after = mod.readNotificationIconByKey('key', true);
    assert.ok(after.icon, 'a stale read returned no icon: the keyed cache was destroyed, not expired');
    assert.equal(after.stale, true, 'it should still report itself stale so a repaint follows');
  }
});

test('a group summary repaints the tray but never opens a detail view', () => {
  // The container Android posts to stand in for a bundle. Everything it
  // represents is also posted in its own right, so opening a detail view for it
  // interrupts once for the container and again for each child.
  //
  // Upstream already tests this flag for TRAY ICONS in
  // shouldShowNotificationIcon; the path that opens a detail view did not, and
  // that gap had no test until this one.
  const file = ts.createSourceFile('controller.ts', source('app/g2/dashboard-controller.ts'), ts.ScriptTarget.Latest, true);
  const controller = file.statements.find((node) => ts.isClassDeclaration(node) && node.name.text === 'DashboardController');
  const handler = controller.members.find((node) => node.name?.getText(file) === 'handleAndroidNotificationPosted');
  const prefs = store();

  const run = (isGroupSummary) => {
    let wakes = 0, popups = 0, renders = 0;
    const { Harness } = evaluate(`export class Harness { ${handler.getText(file)} }`, null, {
      ALL_NOTIFICATIONS: 0x7fffffff,
      readActiveNotifications: () => [{ ...mail, key: 'key', isGroupSummary }],
      shouldShowNotificationOnGlasses: prefs.shouldShowNotificationOnGlasses,
      readNotificationIconByKey: () => ({ icon: null, stale: false }),
      warmActiveNotificationIcons: () => {},
      shell: { isScreenOn: () => false, wake: () => { wakes++; return true; },
               openNotificationModal: () => popups++ },
    });
    const instance = new Harness();
    instance.requestShellRender = () => { renders++; };
    instance.appendLog = () => {};
    return instance.handleAndroidNotificationPosted('key').then(() => ({ wakes, popups, renders }));
  };

  return Promise.all([run(true), run(false)]).then(([summary, ordinary]) => {
    // Suppressed: no detail view, and no WAKE either -- a container must not
    // light up a sleeping display.
    assert.equal(summary.popups, 0);
    assert.equal(summary.wakes, 0);
    // The chrome still repaints, because the posted event already invalidated
    // the icon caches before any of this ran.
    assert.equal(summary.renders, 1);
    // A notification of its own is unaffected.
    assert.equal(ordinary.popups, 1);
    assert.equal(ordinary.wakes, 1);
  });
});

test('a foreground-service notification repaints the tray but never opens a card', async () => {
  // startForeground() requires a notification on API 26+ and the platform sets
  // FLAG_FOREGROUND_SERVICE on it. Measured on hardware: the detail view
  // read "<App> is doing work in the background" and beat the real
  // message to the screen by 660ms, so the interruption OPENED with a
  // placeholder that says nothing about the message arriving.
  const file = ts.createSourceFile('controller.ts', source('app/g2/dashboard-controller.ts'), ts.ScriptTarget.Latest, true);
  const controller = file.statements.find((node) => ts.isClassDeclaration(node) && node.name.text === 'DashboardController');
  const handler = controller.members.find((node) => node.name?.getText(file) === 'handleAndroidNotificationPosted');
  const prefs = store();

  const run = (isForegroundService) => {
    let wakes = 0, popups = 0, renders = 0;
    const { Harness } = evaluate(`export class Harness { ${handler.getText(file)} }`, null, {
      ALL_NOTIFICATIONS: 0x7fffffff,
      readActiveNotifications: () => [{ ...mail, key: 'key', isForegroundService }],
      shouldShowNotificationOnGlasses: prefs.shouldShowNotificationOnGlasses,
      readNotificationIconByKey: () => ({ icon: null, stale: false }),
      warmActiveNotificationIcons: () => {},
      shell: { isScreenOn: () => false, wake: () => { wakes++; return true; },
               openNotificationModal: () => popups++ },
    });
    const instance = new Harness();
    instance.requestShellRender = () => { renders++; };
    instance.appendLog = () => {};
    return instance.handleAndroidNotificationPosted('key').then(() => ({ wakes, popups, renders }));
  };

  // Suppressed: no card, and critically no WAKE either -- this must not light
  // up the display for a notification addressed to the system.
  const suppressed = await run(true);
  assert.equal(suppressed.popups, 0);
  assert.equal(suppressed.wakes, 0);
  // The tray still repaints, because the posted event invalidated its cache.
  assert.equal(suppressed.renders, 1);

  // An ordinary notification is unaffected.
  const normal = await run(false);
  assert.equal(normal.popups, 1);
  assert.equal(normal.wakes, 1);
});

test('the top bar icon cache is refilled before any repaint, including for a filtered notification', async () => {
  // The posted event invalidates the tray cache, so whichever repaint runs next
  // paints from an empty one and pops the icons in on the follow-up. The warm
  // must therefore sit ABOVE the filtered early return: the bar reflects the
  // phone's tray, which changes even for a notification the wearer has hidden.
  const file = ts.createSourceFile('controller.ts', source('app/g2/dashboard-controller.ts'), ts.ScriptTarget.Latest, true);
  const controller = file.statements.find((node) => ts.isClassDeclaration(node) && node.name.text === 'DashboardController');
  const handler = controller.members.find((node) => node.name?.getText(file) === 'handleAndroidNotificationPosted');
  const prefs = store();
  prefs.setNotificationSourceEnabled(mail, false);
  const order = [];
  const { Harness } = evaluate(`export class Harness { ${handler.getText(file)} }`, null, {
    ALL_NOTIFICATIONS: 0x7fffffff,
    readActiveNotifications: () => [{ ...mail, key: 'key' }],
    shouldShowNotificationOnGlasses: prefs.shouldShowNotificationOnGlasses,
    readNotificationIconByKey: () => ({ icon: null, stale: false }),
    warmActiveNotificationIcons: () => order.push('warm'),
    shell: { isScreenOn: () => true, wake: () => false, openNotificationModal: () => {} },
  });
  const instance = new Harness();
  instance.requestShellRender = () => order.push('render');
  await instance.handleAndroidNotificationPosted('key');
  // Filtered out, so it never opens a card -- but the bar still repaints, and
  // the warm has to come first or that repaint is the one that pops.
  assert.deepEqual(order, ['warm', 'render']);
});

test('the top bar draws no more icons than the room it measured', () => {
  // Runs the real draw block rather than matching its source. The icon cache is
  // not keyed by maxIcons, so one filled while the bar was wider (a shorter
  // clock, a narrower battery cluster) hands back more icons than the current
  // paint has room for.
  const src = source('app/ui/shell/chrome-layer.ts');
  const open = src.indexOf('    if (maxIcons > 0) {');
  let depth = 0, end = open;
  for (let i = src.indexOf('{', open); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  // The block is TypeScript (`icons[index]!`), so transpile before running it.
  const block = ts.transpileModule(src.slice(open, end), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;

  const run = (available, cached) => {
    const drawnAt = [];
    const image = { drawImage: (_icon, x) => drawnAt.push(x) };
    const fn = new Function(
      'maxIcons', 'image', 'readActiveNotificationIcons', 'renderPassAllowsStaleData',
      'noteStaleDataUsed', 'NOTIFICATION_ICON_SIZE', 'TOP_BAR_HEIGHT', 'barTop', 'iconsX',
      block,
    );
    fn(available, image, () => ({ icons: new Array(cached).fill({}), stale: false }),
       () => false, () => {}, 16, 24, 0, 100);
    return drawnAt;
  };

  // The cache holds more than this paint measured room for: clamp to the room.
  assert.equal(run(3, 8).length, 3);
  // Fewer cached than room: draw what there is, not the measured count.
  assert.equal(run(8, 2).length, 2);
  // Exactly enough.
  assert.equal(run(4, 4).length, 4);
  // And they step across the bar rather than piling up.
  assert.deepEqual(run(3, 8), [100, 120, 140]);
});
test('a notification card closing does not sleep the screen when another card replaced it', () => {
  // Two apps posting for one message (an SMS also bridged to a chat app) put a
  // second modal on top of the first. When the first auto-closes, popIfTop
  // matches nothing and returns false -- and sleeping on that path blanks the
  // display out from under the card the wearer is actually reading, which the
  // next render then wakes straight back up. Measured on hardware as a fully
  // dark frame standing for 760ms and 1330ms in two captures.
  const file = ts.createSourceFile('shell.ts', source('app/ui/shell/shell.ts'), ts.ScriptTarget.Latest, true);
  const shellClass = file.statements.find((node) => ts.isClassDeclaration(node) && node.members?.some(
    (m) => m.name?.getText(file) === 'closeNotificationModal'));
  const method = shellClass.members.find((node) => node.name?.getText(file) === 'closeNotificationModal');
  const { Harness } = evaluate(`export class Harness { ${method.getText(file)} }`, null, {});

  const run = ({ topMatches, wokeScreen }) => {
    let sleeps = 0, renders = 0, popped = 0;
    const modal = { id: 'modal' };
    const instance = new Harness();
    instance.stack = { popIfTop: (predicate) => {
      if (!topMatches) return false;
      popped++; return predicate(modal);
    } };
    instance.sleep = () => { sleeps++; };
    instance.config = { requestShellRender: () => { renders++; } };
    instance.closeNotificationModal(modal, wokeScreen);
    return { sleeps, renders, popped };
  };

  // The card that woke the screen IS the one on screen: closing it sleeps.
  assert.deepEqual(run({ topMatches: true, wokeScreen: true }).sleeps, 1);
  // Another card is on top, so this close pops nothing and must NOT sleep.
  assert.deepEqual(run({ topMatches: false, wokeScreen: true }).sleeps, 0);
  // A card that did not wake the screen never sleeps it either way.
  assert.deepEqual(run({ topMatches: true, wokeScreen: false }).sleeps, 0);
  assert.deepEqual(run({ topMatches: false, wokeScreen: false }).sleeps, 0);
  // The repaint is unconditional: the stack changed shape either way.
  assert.equal(run({ topMatches: false, wokeScreen: true }).renders, 1);
});
