'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { build } = require('../scripts/build.cjs');
const { zip, crc32 } = require('../scripts/release.cjs');
const { mock, fixture } = require('./obsidian-mock.cjs');
const root = path.resolve(__dirname, '..');

test('CommonJS bundle 可重复、模块隔离，只外部 require obsidian', async () => {
  const first = build(), second = build(); assert.equal(first, second);
  assert.equal(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), first);
  assert.equal(/\brequire\(['"]\./.test(first), false);
  const module = { exports: {} }, externals = [];
  const context = vm.createContext({ module, console, Intl, Date, setTimeout,
    require(id) { externals.push(id); assert.equal(id, 'obsidian'); return mock; } });
  vm.runInContext(first, context, { filename: 'main.js' });
  const plugin = new module.exports(); plugin.app = fixture().app; await plugin.onload();
  await plugin.saveAsset({ name: 'Bundle 资产', kind: 'physical', amount: '17.25', acquiredOn: '2026-10-13' });
  assert.equal(plugin.store.snapshot.financialEvents.events[0].amountMinor, 1725);
  assert.deepEqual(externals, ['obsidian']);
  assert.equal(first.includes('externalRequire("obsidian")'), true);
});

test('ZIP 使用标准 CRC32，固定时间，可重复且恰含三个安装文件', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const entries = ['main.js', 'manifest.json', 'styles.css'].map(file => ['asset-management/' + file, fs.readFileSync(path.join(root, file))]);
  const archive = zip(entries); assert.deepEqual(archive, zip(entries));
  let offset = 0;
  for (const [name, body] of entries) {
    assert.equal(archive.readUInt32LE(offset), 0x04034b50);
    assert.equal(archive.readUInt16LE(offset + 8), 0);
    const nameLength = archive.readUInt16LE(offset + 26), extraLength = archive.readUInt16LE(offset + 28);
    assert.equal(archive.subarray(offset + 30, offset + 30 + nameLength).toString(), name);
    assert.equal(archive.readUInt32LE(offset + 14), crc32(body));
    assert.equal(archive.readUInt32LE(offset + 18), body.length);
    const start = offset + 30 + nameLength + extraLength;
    assert.deepEqual(archive.subarray(start, start + body.length), body);
    offset = start + body.length;
  }
  assert.equal(archive.readUInt32LE(offset), 0x02014b50);
  const end = archive.length - 22;
  assert.equal(archive.readUInt32LE(end), 0x06054b50);
  assert.equal(archive.readUInt16LE(end + 10), 3);
  assert.equal(archive.readUInt32LE(end + 16), offset);
  assert.equal(archive.readUInt32LE(end + 12), end - offset);
});

test('manifest、versions 和 package 版本一致，桌面最低 1.5.0', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const versions = JSON.parse(fs.readFileSync(path.join(root, 'versions.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.id, 'asset-management'); assert.equal(manifest.minAppVersion, '1.5.0'); assert.equal(manifest.isDesktopOnly, true);
  assert.equal(versions[manifest.version], manifest.minAppVersion); assert.equal(pkg.version, manifest.version);
  assert.equal(Object.keys(pkg.dependencies || {}).length, 0); assert.equal(Object.keys(pkg.devDependencies || {}).length, 0);
});
