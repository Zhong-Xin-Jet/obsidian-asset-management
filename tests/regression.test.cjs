'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AssetStore, emptySnapshot, validateDataPath } = require('../src/store');
const { saveAssetInput, deleteAssetRecords, assetFinancials, parseAmount, purchaseAmountText } = require('../src/asset-actions');
const { newFormalV2Asset, FORMAL_ASSET_KINDS, validateFormalV2Asset } = require('../api/assets');
const { fixture, loadPlugin, mock } = require('./obsidian-mock.cjs');
const input = (kind = 'physical', amount = '12.34') => ({ name: '测试资产', kind, amount, acquiredOn: '2026-10-13', currency: 'CNY' });

test('隐藏目录直接使用 adapter，缺失文件可创建嵌套目录', async () => {
  const f = fixture(); f.settings.dataPath = '.asset-management/nested/data.json';
  const store = new AssetStore(f); await store.load();
  await store.mutate(snapshot => saveAssetInput(snapshot, input()));
  assert.ok(f.files.has(f.settings.dataPath));
  assert.ok(f.directories.has('.asset-management/nested'));
  const loaded = new AssetStore(f); await loaded.load();
  assert.equal(loaded.snapshot.assets.assets.length, 1);
  assert.equal(assetFinancials(loaded.snapshot, loaded.snapshot.assets.assets[0]).acquisitionAmountMinor, 1234);
});

test('损坏 JSON、错误结构、读取/exists 失败全部锁写，不空覆盖', async () => {
  for (const body of ['{broken', 'null', '{}', '{"assets":{"assets":null}}']) {
    const f = fixture(body), store = new AssetStore(f);
    await assert.rejects(store.load());
    await assert.rejects(store.mutate(() => {}), /锁写/);
    assert.equal(f.files.get(f.dataPath), body); assert.equal(f.adapter.writes, 0);
  }
  for (const flag of ['failRead', 'failExists']) {
    const f = fixture(emptySnapshot()); f.adapter[flag] = true;
    const store = new AssetStore(f); await assert.rejects(store.load());
    await assert.rejects(store.mutate(() => {})); assert.equal(f.adapter.writes, 0);
  }
});

test('未知根字段和包装字段跨保存保留，未知/无效资产不过滤并锁写', async () => {
  const source = emptySnapshot(); source.future = { value: [1, 2] }; source.assets.futureFlag = true;
  const f = fixture(source), store = new AssetStore(f); await store.load();
  await store.mutate(snapshot => saveAssetInput(snapshot, input()));
  assert.deepEqual(JSON.parse(f.files.get(f.dataPath)).future, source.future);
  assert.equal(store.snapshot.assets.futureFlag, true);
  for (const invalid of [null, { id: 'invalid' }, { ...store.snapshot.assets.assets[0], unknown: '保留' }]) {
    const raw = emptySnapshot(); raw.assets.assets.push(invalid);
    const bad = fixture(raw), locked = new AssetStore(bad); await assert.rejects(locked.load());
    assert.deepEqual(locked.snapshot.assets.assets, [invalid]);
    await assert.rejects(locked.mutate(() => {})); assert.equal(bad.adapter.writes, 0);
    assert.deepEqual(JSON.parse(bad.files.get(bad.dataPath)), raw);
  }
});

test('未知财务字段保留，验证失败锁写', async () => {
  const data = emptySnapshot(); saveAssetInput(data, input()); data.financialEvents.events[0].futureField = 42;
  const f = fixture(data), store = new AssetStore(f); await assert.rejects(store.load());
  assert.equal(store.snapshot.financialEvents.events[0].futureField, 42);
  await assert.rejects(store.mutate(() => {})); assert.equal(f.adapter.writes, 0);
});

test('保存失败内存回滚、锁写；安全重载后可恢复', async () => {
  const f = fixture(emptySnapshot()), store = new AssetStore(f); await store.load();
  const before = JSON.stringify(store.snapshot); f.adapter.failWrite = true;
  await assert.rejects(store.mutate(snapshot => saveAssetInput(snapshot, input())), /保存失败/);
  assert.equal(JSON.stringify(store.snapshot), before); assert.ok(store.lockReason);
  await assert.rejects(store.mutate(() => {}), /锁写/);
  f.adapter.failWrite = false; await store.load(); await store.mutate(snapshot => saveAssetInput(snapshot, input()));
  assert.equal(store.snapshot.assets.assets.length, 1);
});

test('mutator/验证失败回滚且不污染后续队列', async () => {
  const f = fixture(), store = new AssetStore(f); await store.load();
  await assert.rejects(store.mutate(snapshot => { snapshot.assets.assets.push(null); throw new Error('事务失败'); }));
  await assert.rejects(store.mutate(snapshot => snapshot.assets.assets.push(null)));
  assert.equal(store.snapshot.assets.assets.length, 0); assert.equal(f.adapter.writes, 0);
  await store.mutate(snapshot => saveAssetInput(snapshot, input())); assert.equal(f.adapter.writes, 1);
});

test('并发修改串行执行，成功写盘后才替换内存', async () => {
  const f = fixture(), store = new AssetStore(f); await store.load();
  let unblock; const gate = new Promise(resolve => { unblock = resolve; });
  const originalWrite = f.adapter.write; let entered;
  const writing = new Promise(resolve => { entered = resolve; });
  f.adapter.write = async function(...args) { entered(); await gate; return originalWrite.apply(this, args); };
  const first = store.mutate(snapshot => saveAssetInput(snapshot, input()));
  await writing; assert.equal(store.snapshot.assets.assets.length, 0);
  const jobs = Array.from({ length: 9 }, () => store.mutate(snapshot => saveAssetInput(snapshot, input())));
  unblock(); await Promise.all([first, ...jobs]);
  assert.equal(store.snapshot.assets.assets.length, 10); assert.equal(f.adapter.writes, 10);
  assert.equal(JSON.parse(f.files.get(f.dataPath)).assets.assets.length, 10);
});

test('磁盘外部修改/删除/新建及保存前读取失败均禁止覆盖', async () => {
  for (const change of ['modify', 'delete', 'readFail', 'create']) {
    const f = fixture(change === 'create' ? undefined : emptySnapshot()), store = new AssetStore(f); await store.load();
    if (change === 'modify' || change === 'create') f.files.set(f.dataPath, '{"external":true}');
    if (change === 'delete') f.files.delete(f.dataPath);
    if (change === 'readFail') f.adapter.failRead = true;
    const disk = f.files.get(f.dataPath);
    await assert.rejects(store.mutate(snapshot => saveAssetInput(snapshot, input())));
    assert.equal(f.adapter.writes, 0); assert.equal(f.files.get(f.dataPath), disk); assert.equal(store.snapshot.assets.assets.length, 0);
  }
});

test('设置变更不即时切换或迁移路径，拒绝逃逸/.obsidian/Windows 别名', async () => {
  const f = fixture(), store = new AssetStore(f); await store.load();
  f.settings.dataPath = '.asset-management/other.json'; await store.mutate(snapshot => saveAssetInput(snapshot, input()));
  assert.ok(f.files.has(f.dataPath)); assert.equal(f.files.has(f.settings.dataPath), false);
  for (const path of ['../data.json', '/data.json', 'C:/data.json', '.asset-management/../data.json', '.asset-management/.OBSIDIAN/x.json', '.asset-management\\x.json', '.asset-management//x.json', '.asset-management/x./a.json', '.asset-management/x /a.json']) assert.throws(() => validateDataPath(path));
  f.settings.dataPath = '.obsidian/data.json'; const invalid = new AssetStore(f); await assert.rejects(invalid.load()); await assert.rejects(invalid.mutate(() => {}));
});

test('五类创建分类合法，财务金额不写入实体 details', async () => {
  const expected = ['otherPhysical', 'otherVirtual', 'otherVirtual', 'prepaidAmount', 'prepaidCount'];
  for (const [index, kind] of FORMAL_ASSET_KINDS.entries()) {
    const f = fixture(), store = new AssetStore(f); await store.load();
    await store.mutate(snapshot => saveAssetInput(snapshot, input(kind)));
    const asset = store.snapshot.assets.assets[0]; assert.ok(validateFormalV2Asset(asset).valid);
    assert.equal(asset.categoryId, expected[index]); assert.equal(asset.details.purchaseAmountMinor, undefined);
    assert.equal(assetFinancials(store.snapshot, asset).acquisitionAmountMinor, 1234);
  }
});

test('购买金额连续更正为替代链，原记录保留且不累计旧金额', async () => {
  const f = fixture(), store = new AssetStore(f); await store.load();
  await store.mutate(snapshot => saveAssetInput(snapshot, input()));
  const id = store.snapshot.assets.assets[0].id;
  for (const amount of ['30.50', '40.00', '0.00']) await store.mutate(snapshot => saveAssetInput(snapshot, input('physical', amount), id));
  const events = store.snapshot.financialEvents.events; assert.equal(events.length, 4);
  assert.deepEqual(events.map(event => event.amountMinor), [1234, 3050, 4000, 0]);
  for (let index = 1; index < events.length; index++) { assert.equal(events[index].replacesEventId, events[index - 1].id); assert.ok(events[index - 1].voidedAt); }
  assert.equal(assetFinancials(store.snapshot, store.snapshot.assets.assets[0]).acquisitionAmountMinor, 0);
  await store.mutate(snapshot => saveAssetInput(snapshot, input('physical', '0'), id)); assert.equal(store.snapshot.financialEvents.events.length, 4);
  const reloaded = new AssetStore(f); await reloaded.load(); assert.equal(reloaded.lockReason, null);
});

test('无效替代链不会因支持连续更正而被放行', () => {
  const valid = emptySnapshot(), asset = saveAssetInput(valid, input());
  saveAssetInput(valid, input('physical', '30'), asset.id);
  saveAssetInput(valid, input('physical', '40'), asset.id);
  for (const damage of ['missing', 'branch', 'cycle', 'activeOriginal', 'ownerMismatch', 'voidedTail']) {
    const data = JSON.parse(JSON.stringify(valid)), events = data.financialEvents.events;
    if (damage === 'missing') events[1].replacesEventId = newFormalV2Asset({ kind: 'physical', name: '无事件', status: 'wishlist' }).id;
    if (damage === 'branch') events[2].replacesEventId = events[0].id;
    if (damage === 'cycle') events[0].replacesEventId = events[2].id;
    if (damage === 'activeOriginal') events[0].voidedAt = null;
    if (damage === 'ownerMismatch') events[1].currency = 'USD';
    if (damage === 'voidedTail') events[2].voidedAt = new Date().toISOString();
    assert.throws(() => assetFinancials(data, asset));
  }
});

test('金额严格解析、kind 不可更改、种草只编辑名称、过期编辑拒绝', async () => {
  assert.equal(parseAmount('0.29', 'CNY'), 29); assert.equal(parseAmount('123', 'JPY'), 123);
  for (const value of ['', '-1', '1.001', 'NaN', '1e5', '9007199254740992']) assert.throws(() => parseAmount(value, 'CNY'));
  const data = emptySnapshot(), owned = saveAssetInput(data, input());
  assert.throws(() => saveAssetInput(data, input('prepaidCount'), owned.id), /类型/);
  assert.throws(() => saveAssetInput(data, input(), owned.id, { expectedAsset: { ...owned, name: '旧名称' } }), /已修改/);
  const wish = newFormalV2Asset({ kind: 'physical', name: '种草', status: 'wishlist' }); data.assets.assets.push(wish);
  const edited = saveAssetInput(data, { name: '新名称', kind: wish.kind, amount: '30', acquiredOn: 'invalid' }, wish.id);
  assert.equal(edited.name, '新名称'); assert.equal(edited.acquiredOn, undefined); assert.equal(data.financialEvents.events.length, 1);
});

test('最大安全金额回填不经过浮点舍入', () => {
  const data = emptySnapshot(), asset = saveAssetInput(data, input('physical', '90071992547409.91'));
  assert.equal(purchaseAmountText(data, asset), '90071992547409.91');
  assert.equal(parseAmount(purchaseAmountText(data, asset), 'CNY'), Number.MAX_SAFE_INTEGER);
});

test('删除级联全部侧记录，保留其他资产侧记录和无关字段', async () => {
  const data = emptySnapshot(), asset = saveAssetInput(data, input()), other = saveAssetInput(data, input());
  for (const [key, field] of Object.entries({ wishlistEvents: 'events', operationLogs: 'logs', maintenance: 'records', usage: 'records', prepaidTransactions: 'records', lifecycleEvents: 'events', subscriptionPeriods: 'records' })) data[key][field].push({ assetId: asset.id }, { assetId: other.id });
  data.future = { keep: true }; deleteAssetRecords(data, asset.id);
  assert.equal(data.assets.assets.length, 1); assert.deepEqual(data.future, { keep: true });
  for (const wrapper of Object.values(data)) for (const field of ['events', 'logs', 'records']) if (Array.isArray(wrapper[field])) assert.equal(wrapper[field].some(record => record.assetId === asset.id), false);
});

test('Obsidian mock：入口加载、五类表单保存、编辑回填金额/禁用 kind、设置固定路径', async () => {
  const Plugin = loadPlugin(), plugin = new Plugin(), f = fixture(); plugin.app = f.app; await plugin.onload();
  for (const kind of FORMAL_ASSET_KINDS) {
    plugin.commands.find(command => command.id === 'add-asset').callback(); const modal = mock.lastModal;
    modal.contentEl.settings.find(setting => setting.name === '名称').text.change('表单 ' + kind);
    modal.contentEl.settings.find(setting => setting.name === '类型').dropdown.change(kind);
    modal.contentEl.settings.find(setting => setting.name.startsWith('购买金额')).text.change('23.45');
    await modal.contentEl.settings.find(setting => setting.button).button.click(); assert.ok(modal.closed);
  }
  assert.equal(plugin.store.snapshot.assets.assets.length, 5);
  const view = plugin.viewFactory({ app: plugin.app }); await view.render();
  const list = view.containerEl.children.find(child => child.cls === 'am-list');
  list.children[0].children.find(child => child.cls === 'am-card-actions').children[0].onclick();
  const edit = mock.lastModal;
  assert.equal(edit.contentEl.settings.find(setting => setting.name === '类型').dropdown.disabled, true);
  assert.equal(edit.contentEl.settings.find(setting => setting.name.startsWith('购买金额')).text.value, '23.45');
  plugin.tab.display(); assert.equal(plugin.tab.containerEl.settings.find(setting => setting.name === '数据文件').text.disabled, true);
});
