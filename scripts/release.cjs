'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { build } = require('./build.cjs');
const root = path.resolve(__dirname, '..');
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const filename = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x21, 12); // 固定日期 1980-01-01，保证可重复产物。
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, filename);
    offset += local.length + filename.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
function release() {
  const tests = fs.readdirSync(path.join(root, 'tests')).filter(name => name.endsWith('.test.cjs')).sort().map(name => path.join(root, 'tests', name));
  const testResult = spawnSync(process.execPath, ['--test', ...tests], { cwd: root, stdio: 'inherit' });
  if (testResult.status !== 0) throw new Error('测试未通过，停止发布');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const versions = JSON.parse(fs.readFileSync(path.join(root, 'versions.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (manifest.id !== 'asset-management' || versions[manifest.version] !== manifest.minAppVersion || pkg.version !== manifest.version) throw new Error('发布版本/清单不一致');
  if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== manifest.version && process.env.GITHUB_REF_NAME !== 'v' + manifest.version) throw new Error('Tag 必须匹配 manifest 版本');
  build();
  const dist = path.join(root, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  const files = ['main.js', 'manifest.json', 'styles.css'];
  const entries = files.map(file => {
    const data = fs.readFileSync(path.join(root, file));
    fs.writeFileSync(path.join(dist, file), data);
    return [manifest.id + '/' + file, data];
  });
  const archive = path.join(dist, manifest.id + '-' + manifest.version + '.zip');
  fs.writeFileSync(archive, zip(entries));
  console.log('发布成功：dist/{main.js,manifest.json,styles.css} 和 ' + path.basename(archive));
}
if (require.main === module) release();
module.exports = { crc32, zip };
