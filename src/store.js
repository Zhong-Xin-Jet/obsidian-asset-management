'use strict';
const { validateFormalV2Asset, validateFinancialRecord, projectFormalFinancials } = require('../api/assets');

const clone = value => JSON.parse(JSON.stringify(value));
function validateDataPath(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() || /[\\:*?"<>|\x00-\x1f]/.test(value) || value.startsWith('/')) throw new Error('数据路径必须为 Vault 内相对路径');
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || part.toLowerCase() === '.obsidian')) throw new Error('禁止路径逃逸或访问 .obsidian');
  if (parts[0] !== '.asset-management' || parts.length < 2 || !value.endsWith('.json')) throw new Error('数据文件必须位于 .asset-management 目录内并以 .json 结尾');
  return value;
}
function emptySnapshot() {
  return {
    assets: { schemaGeneration: 'formal-v2', schemaVersion: 1, assets: [] },
    tags: { schemaVersion: 1, tags: [] },
    dimensions: { schemaVersion: 1, brands: [], channels: [] },
    wishlistEvents: { schemaVersion: 1, events: [] },
    operationLogs: { schemaVersion: 1, logs: [] },
    maintenance: { schemaVersion: 1, records: [] },
    usage: { schemaVersion: 1, records: [] },
    prepaidTransactions: { schemaVersion: 1, records: [] },
    financialEvents: { schemaVersion: 1, events: [] },
    lifecycleEvents: { schemaVersion: 1, events: [] },
    subscriptionPeriods: { schemaVersion: 1, records: [] },
    exchangeRates: { schemaVersion: 1, baseCurrency: 'CNY', rates: {} },
  };
}
function normalizeSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('快照必须是对象');
  const result = clone(raw);
  for (const [key, defaults] of Object.entries(emptySnapshot())) {
    if (!Object.hasOwn(result, key)) {
      if (key === 'assets') throw new Error('缺少 assets 数据');
      result[key] = defaults;
      continue;
    }
    const wrapper = result[key];
    if (!wrapper || typeof wrapper !== 'object' || Array.isArray(wrapper)) throw new Error(key + ' 格式错误');
    for (const [field, value] of Object.entries(defaults)) {
      if (Array.isArray(value) && !Array.isArray(wrapper[field])) throw new Error(key + '.' + field + ' 必须为数组');
    }
  }
  return result;
}
function validateSnapshot(snapshot) {
  normalizeSnapshot(snapshot);
  if (snapshot.assets.schemaGeneration !== 'formal-v2' || snapshot.assets.schemaVersion !== 1) throw new Error('不支持的资产数据版本');
  const ids = new Set();
  for (const asset of snapshot.assets.assets) {
    const result = validateFormalV2Asset(asset);
    if (!result.valid) throw new Error('无效资产（原样保留）：' + result.errors.join('; '));
    if (ids.has(asset.id)) throw new Error('资产 ID 重复');
    ids.add(asset.id);
  }
  for (const event of snapshot.financialEvents.events) {
    const result = validateFinancialRecord(event);
    if (!result.valid) throw new Error('无效财务事件（原样保留）：' + result.errors.join('; '));
    if (!ids.has(event.assetId)) throw new Error('财务事件资产不存在');
    if (snapshot.assets.assets.find(asset => asset.id === event.assetId).status === 'wishlist') throw new Error('种草资产不能包含财务事件');
  }
  for (const asset of snapshot.assets.assets) {
    projectFormalFinancials(asset, snapshot.financialEvents.events.filter(event => event.assetId === asset.id));
  }
}
class AssetStore {
  constructor(plugin) {
    this.adapter = plugin.app.vault.adapter;
    this.path = null;
    this.pathError = null;
    try { this.path = validateDataPath(plugin.settings.dataPath); } catch (error) { this.pathError = error; }
    this.snapshot = emptySnapshot();
    this.baseline = null;
    this.lockReason = '数据尚未加载';
    this.queue = Promise.resolve();
  }
  enqueue(action) {
    const job = this.queue.then(action);
    this.queue = job.catch(() => {});
    return job;
  }
  async readDisk() {
    return await this.adapter.exists(this.path) ? await this.adapter.read(this.path) : null;
  }
  load() {
    return this.enqueue(async () => {
      this.lockReason = '正在读取数据';
      try {
        if (this.pathError) throw this.pathError;
        const body = await this.readDisk();
        const candidate = body === null ? emptySnapshot() : normalizeSnapshot(JSON.parse(body));
        // 保留无效记录供查看/导出，但任何验证失败都禁止写入。
        this.snapshot = candidate;
        this.baseline = body;
        validateSnapshot(candidate);
        this.lockReason = null;
        return this.snapshot;
      } catch (error) {
        this.lockReason = error.message;
        throw error;
      }
    });
  }
  mutate(mutator) {
    return this.enqueue(async () => {
      if (this.lockReason) throw new Error('数据已锁写：' + this.lockReason);
      const candidate = clone(this.snapshot);
      const result = await mutator(candidate);
      validateSnapshot(candidate);
      const body = JSON.stringify(candidate, null, 2);
      try {
        const parts = this.path.split('/').slice(0, -1);
        for (let i = 1; i <= parts.length; i++) {
          const parent = parts.slice(0, i).join('/');
          if (!await this.adapter.exists(parent)) await this.adapter.mkdir(parent);
        }
        if (await this.readDisk() !== this.baseline) throw new Error('磁盘数据已被外部修改，请备份后安全重载');
        await this.adapter.write(this.path, body);
      } catch (error) {
        this.lockReason = error.message;
        throw error;
      }
      this.baseline = body;
      this.snapshot = clone(candidate);
      return result;
    });
  }
}
module.exports = { AssetStore, validateDataPath, emptySnapshot, normalizeSnapshot, validateSnapshot };
