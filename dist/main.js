// 自动生成：请编辑 src/ 和 api/，然后执行构建。
module.exports = (function(externalRequire) {
"use strict";
const factories = {
"src/main.js": function(module, exports, __require, externalRequire) {
'use strict';
const { Plugin, ItemView, Modal, Notice, Setting, PluginSettingTab } = externalRequire("obsidian");
const { FORMAL_ASSET_KIND, FORMAL_ASSET_KINDS, validateFormalV2Asset } = __require("api/assets.js");
const { buildFormalDashboard } = __require("api/report.js");
const { todayISO, formatAmountMinor } = __require("api/algorithms.js");
const { AssetStore } = __require("src/store.js");
const { assetFinancials, purchaseAmountText, saveAssetInput, deleteAssetRecords } = __require("src/asset-actions.js");

const VIEW_TYPE_ASSET_MANAGEMENT = 'asset-management-view';
const DEFAULT_SETTINGS = {
  dataPath: '.asset-management/data.json',
  preferredCurrency: 'CNY',
  currencyDisplayMode: 'native',
  defaultStatus: 'all',
  defaultSort: 'newest',
};

class AssetManagementView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.filter = ''; }
  getViewType() { return VIEW_TYPE_ASSET_MANAGEMENT; }
  getDisplayText() { return '资产管理'; }
  getIcon() { return 'package'; }
  async onOpen() { await this.render(); }
  async render() {
    const root = this.containerEl;
    root.empty(); root.addClass('am-obsidian-view');
    const snapshot = this.plugin.store.snapshot;
    const assets = snapshot.assets.assets;
    const dashboard = safeDashboard(snapshot);
    const header = root.createDiv({ cls: 'am-header' });
    header.createEl('h2', { text: '资产管理' });
    const actions = header.createDiv({ cls: 'am-actions' });
    const add = actions.createEl('button', { text: '新增资产', cls: 'mod-cta' });
    add.disabled = Boolean(this.plugin.store.lockReason);
    add.onclick = () => new AssetModal(this.app, this.plugin, null, () => this.render()).open();
    const backup = actions.createEl('button', { text: '导出 JSON' });
    backup.onclick = () => this.plugin.exportBackup().catch(error => new Notice('导出失败：' + error.message));
    const reload = actions.createEl('button', { text: '安全重载' });
    reload.onclick = () => this.plugin.reloadStore();
    if (this.plugin.store.lockReason) root.createDiv({ text: '数据已锁写（不会覆盖磁盘）：' + this.plugin.store.lockReason, cls: 'am-empty' });
    const summary = root.createDiv({ cls: 'am-summary' });
    summary.createDiv({ text: `资产 ${assets.length}` });
    summary.createDiv({ text: `在役 ${assets.filter(a => a && a.status === 'active').length}` });
    summary.createDiv({ text: `种草 ${assets.filter(a => a && a.status === 'wishlist').length}` });
    summary.createDiv({ text: `报表区间 ${dashboard ? dashboard.range : '不可用'}` });
    const search = root.createEl('input', { type: 'search', placeholder: '搜索资产名称、备注或分类…', cls: 'am-search' });
    search.value = this.filter; search.oninput = () => { this.filter = search.value; this.renderList(list); };
    const list = root.createDiv({ cls: 'am-list' });
    this.renderList(list);
  }
  renderList(list) {
    list.empty();
    const all = this.plugin.store.snapshot.assets.assets;
    const filtered = all.filter(asset => !this.filter || JSON.stringify(asset).toLowerCase().includes(this.filter.toLowerCase()));
    if (!filtered.length) { list.createDiv({ text: '暂无匹配资产', cls: 'am-empty' }); return; }
    for (const asset of filtered) {
      const card = list.createDiv({ cls: 'am-card' });
      if (!validateFormalV2Asset(asset).valid) {
        card.createDiv({ text: '无效资产已原样保留，请备份并修复数据：' + JSON.stringify(asset) });
        continue;
      }
      const title = card.createDiv({ cls: 'am-card-title' });
      title.createEl('strong', { text: asset.name });
      title.createSpan({ text: asset.status === 'wishlist' ? '种草' : asset.status === 'active' ? '在役' : '退役', cls: `am-status am-status-${asset.status}` });
      card.createDiv({ text: `${kindLabel(asset.kind)} · ${asset.categoryId || '未分类'} · ${asset.acquiredOn || '未购入'}`, cls: 'am-meta' });
      if (asset.status !== 'wishlist') {
        try {
          const financials = assetFinancials(this.plugin.store.snapshot, asset);
          card.createDiv({ text: formatAmountMinor(financials.acquisitionAmountMinor, asset.currency, 'zh-CN'), cls: 'am-money' });
        } catch (error) { card.createDiv({ text: '金额投影失败：' + error.message }); }
      }
      const buttons = card.createDiv({ cls: 'am-card-actions' });
      const edit = buttons.createEl('button', { text: '编辑' });
      edit.disabled = Boolean(this.plugin.store.lockReason);
      edit.onclick = () => new AssetModal(this.app, this.plugin, asset, () => this.render()).open();
      const del = buttons.createEl('button', { text: '删除', cls: 'mod-warning' });
      del.disabled = Boolean(this.plugin.store.lockReason);
      del.onclick = async () => {
        if (!confirm(`确定删除“${asset.name}”及其所有侧记录吗？`)) return;
        try { await this.plugin.deleteAsset(asset.id); } catch (error) { new Notice('删除失败：' + error.message); }
        await this.render();
      };
    }
  }
}

class AssetModal extends Modal {
  constructor(app, plugin, asset, onSaved) { super(app); this.plugin = plugin; this.asset = asset; this.onSaved = onSaved; }
  onOpen() {
    const { contentEl } = this; contentEl.empty(); contentEl.addClass('am-modal');
    contentEl.createEl('h2', { text: this.asset ? '编辑资产' : '新增资产' });
    let name = this.asset?.name || '';
    let kind = this.asset?.kind || FORMAL_ASSET_KIND.PHYSICAL;
    let amount;
    let amountChanged = !this.asset;
    let acquiredOn = this.asset?.acquiredOn || todayISO();
    const wishlist = this.asset?.status === 'wishlist';
    new Setting(contentEl).setName('名称').addText(text => text.setValue(name).onChange(value => { name = value; }));
    new Setting(contentEl).setName('类型').addDropdown(drop => {
      for (const value of FORMAL_ASSET_KINDS) drop.addOption(value, kindLabel(value));
      drop.setValue(kind); drop.setDisabled(Boolean(this.asset)); drop.onChange(value => { kind = value; });
    });
    if (wishlist) contentEl.createDiv({ text: '种草资产本版本只编辑名称，不写入购买字段或财务事件。' });
    else {
      try { amount = this.asset ? purchaseAmountText(this.plugin.store.snapshot, this.asset) : ''; }
      catch (error) { contentEl.createDiv({ text: error.message }); return; }
      new Setting(contentEl).setName(`购买金额（${this.asset?.currency || this.plugin.settings.preferredCurrency}）`).setDesc('新增必填；编辑更正会追加替代事件，保留原事件。旧资产无事件时留空不变。')
        .addText(text => text.setValue(amount).onChange(value => { amount = value; amountChanged = true; }));
      new Setting(contentEl).setName('购买日期').addText(text => text.setValue(acquiredOn).onChange(value => { acquiredOn = value; }));
    }
    new Setting(contentEl).addButton(button => button.setButtonText('保存').setCta().onClick(async () => {
      button.setDisabled(true);
      try {
        await this.plugin.saveAsset({ name, kind, acquiredOn, currency: this.plugin.settings.preferredCurrency,
          amount: wishlist || (!amountChanged && amount === '') ? undefined : amount }, this.asset);
        this.close(); this.onSaved?.();
      } catch (error) { new Notice('保存失败：' + error.message); await this.plugin.refreshViews(); }
      finally { button.setDisabled(false); }
    }));
  }
}

class AssetManagementSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this; containerEl.empty();
    containerEl.createEl('h2', { text: '资产管理设置' });
    new Setting(containerEl).setName('数据文件').setDesc('路径固定至当前加载位置；不自动迁移。已有安全路径设置继续使用，修改设置文件后须重启插件。')
      .addText(text => text.setValue(this.plugin.store.path || this.plugin.settings.dataPath).setDisabled(true));
    new Setting(containerEl).setName('安全重载').setDesc('从同一文件重新读取；失败维持锁写。先备份并修复损坏数据，不会迁移或写入数据。')
      .addButton(button => button.setButtonText('重新读取').onClick(() => this.plugin.reloadStore()));
    new Setting(containerEl).setName('首选货币').addText(text => text.setValue(this.plugin.settings.preferredCurrency).onChange(async value => {
      const currency = value.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) return;
      try { new Intl.NumberFormat('en', { style: 'currency', currency }); } catch (_) { return; }
      this.plugin.settings.preferredCurrency = currency;
      await this.plugin.saveSettings();
    }));
  }
}

function kindLabel(kind) { return ({ physical: '实物', virtualSubscription: '虚拟订阅', virtualPerpetual: '永久授权', prepaidAmount: '金额预付', prepaidCount: '次数预付' })[kind] || kind; }
function safeDashboard(snapshot) { try { return buildFormalDashboard(snapshot, '12m'); } catch (_) { return null; } }

module.exports = class AssetManagementPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.store = new AssetStore(this);
    try { await this.store.load(); } catch (error) { new Notice('资产数据已锁写：' + error.message); }
    this.registerView(VIEW_TYPE_ASSET_MANAGEMENT, leaf => new AssetManagementView(leaf, this));
    this.addRibbonIcon('package', '打开资产管理', () => this.activateView());
    this.addCommand({ id: 'open-asset-management', name: '打开资产管理', callback: () => this.activateView() });
    this.addCommand({ id: 'add-asset', name: '新增资产', callback: () => new AssetModal(this.app, this, null, () => this.refreshViews()).open() });
    this.addSettingTab(new AssetManagementSettingTab(this.app, this));
    this.addCommand({ id: 'export-assets-json', name: '导出资产 JSON 备份', callback: () => this.exportBackup().catch(error => new Notice('导出失败：' + error.message)) });
  }
  async onunload() { this.app.workspace.detachLeavesOfType(VIEW_TYPE_ASSET_MANAGEMENT); }
  async activateView() { const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_ASSET_MANAGEMENT)[0] || this.app.workspace.getRightLeaf(false); await leaf.setViewState({ type: VIEW_TYPE_ASSET_MANAGEMENT, active: true }); this.app.workspace.revealLeaf(leaf); }
  async refreshViews() { for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_ASSET_MANAGEMENT)) await leaf.view.render(); }
  async saveSettings() { await this.saveData(this.settings); }
  async reloadStore() {
    if (!confirm('安全重载只读取磁盘，不迁移或保存。当前内存视图将被磁盘数据替换，是否继续？')) return;
    try { await this.store.load(); new Notice('数据已安全重载'); }
    catch (error) { new Notice('重载失败，保持锁写：' + error.message); }
    await this.refreshViews();
  }
  async saveAsset(input, existing) {
    await this.store.mutate(snapshot => saveAssetInput(snapshot, input, existing?.id, { expectedAsset: existing }));
    await this.refreshViews();
  }
  async deleteAsset(id) { await this.store.mutate(snapshot => deleteAssetRecords(snapshot, id)); await this.refreshViews(); }
  async exportBackup() {
    const path = `asset-management-backup-${todayISO()}-${Date.now()}.json`;
    await this.app.vault.create(path, JSON.stringify(this.store.snapshot, null, 2));
    new Notice(`已导出内存快照 ${path}；读取失败时请另外备份原始数据文件。`);
  }
};

},
"api/assets.js": function(module, exports, __require, externalRequire) {
/* eslint-disable no-undef */
/**
 * SiYuan 资产管理插件 — assets.js
 *
 * 数据模型层：
 *   - formal-v2 五类 Asset 实体、校验、patch 与投影
 *   - 正式财务、生命周期、订阅周期和预付/使用记录契约
 *   - computeAssetDerived（基础派生）/ computeAssetMetrics（含到期徽章 + 4 种折旧 + 5 个虚拟 v2 字段）
 *   - computeNetCost（M10 运行时 maintenanceCost 注入）/ computeDailyCost（4 种日均价决策）/ computeTargetProgress
 *   - computeMaintenanceTotal（M10 维护总费用）— 由 computeNetCost 注入
 *   - computeUsageStats / computeUsageTotalDuration（v0.16-T4-γ，M13 使用统计）
 *   - computeStats（首页汇总）+ applyFilter / sortAssets
 *   - newOperationLog（v0.16-T1，M14 操作日志）：记录 add/update/delete/set-status/wishlist* 6 类 mutation
 *
 * 依赖：./algorithms.js（genId / todayISO / daysBetween）
 *
 * v0.18 formal-v2 数据契约：
 *   - schemaGeneration: 'formal-v2'，schemaVersion: 1
 *   - 删除评分、skipNextRenewal、使用追踪、dailyCostOverrideMinor、
 *     versionLabel、virtualPerpetual.costGoal、wishlist 携带的
 *     categoryId / tagIds / notes、及 reminderPolicy 等 v1 残留字段
 *   - v2 wishlist 仅承载极小字段集（kind/name/currency/cover/wishlist 子对象）
 *   - v2 wishlist 不再校验 kind 与 targetGroup 的一致性；两者独立校验
 *   - v1 normalize 与 reminderPolicy 帮助函数已从该文件中完全移除；任何 v1
 *     normalize 调用现在直接抛 FORMAL_ASSET_INVALID（白名单 declare 时缺
 *     reminderPolicy 等）。也就是说：reminderPolicy 已不再是「白名单能接受
 *     的字段」，而是被 v1/v2 双方在 parse 阶段硬性拒收。剩余 v1 helper
 *     仅服务于 v1→v2 migrate / operation log snapshot 反查，不接 UI 热路径。
 *   - 旧 v1 函数与字段全保留供现有调用方过渡；test 与 UI 切换留到阶段 8/10
 */

'use strict';

const {
    genId,
    todayISO,
    daysBetween,
    createStableId,
    isUUID,
    isForeignKey,
    normalizeForeignKey,
    isEnumValue,
    normalizeEnum,
    isBusinessDate,
    normalizeBusinessDate,
    isUTCInstant,
    normalizeUTCInstant,
    isISO4217Currency,
    normalizeISO4217Currency,
    isAmountMinor,
    normalizeAmountMinor,
    safeMinorAdd,
    safeMinorSubtract,
} = __require("api/algorithms.js");
const { normalizeCover } = __require("api/media.js");

const STATUSES = [
    { id: 'wishlist', emoji: '🌱', key: 'statusWishlist', color: '#67c23a' },
    { id: 'active',   emoji: '✅', key: 'statusActive',   color: '#3575f3' },
    { id: 'retired',  emoji: '⏸️', key: 'statusRetired',  color: '#909399' },
];

const SORTS = [
    { id: 'default',   key: 'sortDefault' },
    { id: 'newest',    key: 'sortNewest' },
    { id: 'oldest',    key: 'sortOldest' },
    { id: 'priceHigh', key: 'sortPriceHigh' },
    { id: 'priceLow',  key: 'sortPriceLow' },
    { id: 'nameAsc',   key: 'sortNameAsc' },
];

const STATUS_ORDER = { active: 0, retired: 1, wishlist: 2 };

const STATUS_MAP = Object.fromEntries(STATUSES.map(s => [s.id, s]));
const SORT_MAP = Object.fromEntries(SORTS.map(s => [s.id, s]));
// Stable domain enums. Existing UI arrays remain below for display metadata.
const ASSET_KIND = Object.freeze({
    PHYSICAL: 'physical',
    VIRTUAL: 'virtual',
    PREPAID: 'prepaid',
});
const ASSET_STATUS = Object.freeze({
    WISHLIST: 'wishlist',
    ACTIVE: 'active',
    RETIRED: 'retired',
});
const FINANCIAL_DIRECTION = Object.freeze({
    OUTFLOW: 'outflow',
    INFLOW: 'inflow',
});
const FINANCIAL_EVENT_TYPE = Object.freeze({
    PURCHASE: 'purchase',
    ADDITIONAL_COST: 'additionalCost',
    MAINTENANCE: 'maintenance',
    SUBSCRIPTION_PAYMENT: 'subscriptionPayment',
    PREPAID_CHARGE: 'prepaidCharge',
    PREPAID_CONSUMPTION: 'prepaidConsumption',
    SALE: 'sale',
    REFUND: 'refund',
    INCOME: 'income',
    ADJUSTMENT: 'adjustment',
});
const LIFECYCLE_EVENT_TYPE = Object.freeze({
    CREATED: 'created',
    WISHLISTED: 'wishlisted',
    ACTIVATED: 'activated',
    RETIRED: 'retired',
    RESTORED: 'restored',
    DELETED: 'deleted',
    STATUS_CHANGED: 'statusChanged',
    MAINTENANCE_RECORDED: 'maintenanceRecorded',
    USAGE_RECORDED: 'usageRecorded',
    PREPAID_TRANSACTION: 'prepaidTransaction',
    SUBSCRIPTION_STARTED: 'subscriptionStarted',
    SUBSCRIPTION_RENEWED: 'subscriptionRenewed',
    SUBSCRIPTION_REOPENED: 'subscriptionReopened',
    SUBSCRIPTION_CANCELLED: 'subscriptionCancelled',
    SUBSCRIPTION_SKIPPED: 'subscriptionSkipped',
});
const SUBSCRIPTION_PERIOD_KIND = Object.freeze({
    TRIAL: 'trial',
    BILLING: 'billing',
    GRACE: 'grace',
    COMPLIMENTARY: 'complimentary',
});
// lifecycleEvents.json uses this canonical shape. Do not substitute the older
// eventType/fromStatus/toStatus envelope here: lifecycle `kind` and `details`
// are the persisted contract used by storage, reports, and mutation paths.
const FORMAL_LIFECYCLE_RECORD_KEYS = Object.freeze([
    'id', 'schemaVersion', 'assetId', 'occurredAt', 'effectiveDate', 'createdAt',
    'source', 'correlationId', 'note', 'replacesEventId', 'voidedAt', 'kind', 'details',
]);
const EVENT_SOURCE = Object.freeze({
    USER: 'user',
    SYSTEM: 'system',
    IMPORT: 'import',
    MIGRATION: 'migration',
    UNDO: 'undo',
});
const ASSET_EXTENSION_NAMESPACE = Object.freeze({
    FINANCIAL: 'financial',
    LIFECYCLE: 'lifecycle',
    SUBSCRIPTION_PERIODS: 'subscriptionPeriods',
    PHYSICAL: 'physical',
    PREPAID: 'prepaid',
});
const DOMAIN_EVENT_SCHEMA_VERSION = 1;
const FINANCIAL_RECORD_KEYS = Object.freeze([
    'id', 'schemaVersion', 'assetId', 'occurredAt', 'effectiveDate', 'createdAt',
    'source', 'correlationId', 'note', 'metadata', 'replacesEventId', 'voidedAt',
    'direction', 'eventType', 'currency', 'amountMinor',
]);
const ASSET_TYPES = Object.freeze(Object.keys(ASSET_KIND).map(key => ASSET_KIND[key]));
const VALID_VIRTUAL_SUBTYPES = Object.freeze(['subscription', 'oneTime']);
const VALID_PREPAID_KINDS = ['amount', 'count'];
const WISHLIST_REASON_MAX_LENGTH = 500;

// Formal-v1 is the only production asset model.
const FORMAL_SCHEMA_GENERATION = 'formal-v1';
const FORMAL_ASSET_SCHEMA_VERSION = 1;
const FORMAL_ASSET_KIND = Object.freeze({
    PHYSICAL: 'physical',
    VIRTUAL_SUBSCRIPTION: 'virtualSubscription',
    VIRTUAL_PERPETUAL: 'virtualPerpetual',
    PREPAID_AMOUNT: 'prepaidAmount',
    PREPAID_COUNT: 'prepaidCount',
});
const FORMAL_ASSET_KINDS = Object.freeze(Object.keys(FORMAL_ASSET_KIND).map(key => FORMAL_ASSET_KIND[key]));
const FORMAL_BILLING_CYCLES = Object.freeze(['monthly', 'quarterly', 'halfYearly', 'yearly']);
// categoryId is a controlled presentation/reporting dimension. It is deliberately
// separate from the old free-form `category` field and never carries money truth.
const FORMAL_CATEGORIES = Object.freeze([
    { id: 'digital', kinds: ['physical'] },
    { id: 'appliance', kinds: ['physical'] },
    { id: 'home', kinds: ['physical'] },
    { id: 'otherPhysical', kinds: ['physical'] },
    { id: 'member', kinds: ['virtualSubscription'] },
    { id: 'software', kinds: ['virtualSubscription', 'virtualPerpetual'] },
    { id: 'service', kinds: ['virtualSubscription'] },
    { id: 'domain', kinds: ['virtualSubscription'] },
    { id: 'ai', kinds: ['virtualSubscription'] },
    { id: 'otherVirtual', kinds: ['virtualSubscription', 'virtualPerpetual'] },
    { id: 'prepaidAmount', kinds: ['prepaidAmount'] },
    { id: 'prepaidCount', kinds: ['prepaidCount'] },
]);
const FORMAL_CATEGORY_IDS = Object.freeze(FORMAL_CATEGORIES.map(category => category.id));

function toFiniteNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function toNullableNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function parseISODate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parts = value.split('-').map(Number);
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return date.getUTCFullYear() === parts[0]
        && date.getUTCMonth() === parts[1] - 1
        && date.getUTCDate() === parts[2]
        ? date
        : null;
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value)
        && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function normalizeMetadata(value) {
    return isPlainObject(value) ? Object.assign({}, value) : {};
}

function validationResult(errors) {
    return { valid: errors.length === 0, errors: errors };
}

function isPositiveSafeInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
}

/**
 * Normalize the shared event envelope used by formal sidecar records.
 */
function normalizeEventEnvelope(value, options) {
    const source = isPlainObject(value) ? value : {};
    const now = normalizeUTCInstant(options && options.now, new Date());
    const occurredAt = normalizeUTCInstant(source.occurredAt, now);
    return {
        id: isUUID(source.id) ? source.id.toLowerCase() : createStableId(),
        schemaVersion: isPositiveSafeInteger(source.schemaVersion) ? source.schemaVersion : DOMAIN_EVENT_SCHEMA_VERSION,
        assetId: normalizeForeignKey(source.assetId),
        occurredAt: occurredAt,
        effectiveDate: normalizeBusinessDate(source.effectiveDate, occurredAt),
        createdAt: normalizeUTCInstant(source.createdAt, now),
        source: normalizeEnum(source.source, EVENT_SOURCE, EVENT_SOURCE.USER),
        correlationId: normalizeForeignKey(source.correlationId),
        note: source.note == null ? '' : String(source.note).trim(),
        metadata: normalizeMetadata(source.metadata),
        replacesEventId: normalizeForeignKey(source.replacesEventId),
        voidedAt: source.voidedAt == null ? null : normalizeUTCInstant(source.voidedAt),
    };
}

function validateEventEnvelope(value) {
    if (!isPlainObject(value)) return validationResult(['event must be an object']);
    const errors = [];
    if (!isUUID(value.id)) errors.push('id must be a valid UUID');
    if (!isPositiveSafeInteger(value.schemaVersion)) errors.push('schemaVersion must be a positive integer');
    if (!isForeignKey(value.assetId)) errors.push('assetId must be a valid foreign key');
    if (!isUTCInstant(value.occurredAt)) errors.push('occurredAt must be a UTC ISO timestamp');
    if (!isBusinessDate(value.effectiveDate)) errors.push('effectiveDate must be YYYY-MM-DD');
    if (!isUTCInstant(value.createdAt)) errors.push('createdAt must be a UTC ISO timestamp');
    if (!isEnumValue(value.source, EVENT_SOURCE)) errors.push('source is invalid');
    if (value.correlationId != null && !isForeignKey(value.correlationId)) errors.push('correlationId must be a valid foreign key');
    if (typeof value.note !== 'string') errors.push('note must be a string');
    if (!isPlainObject(value.metadata)) errors.push('metadata must be an object');
    if (value.replacesEventId != null && !isForeignKey(value.replacesEventId)) errors.push('replacesEventId must be a valid foreign key');
    if (value.voidedAt != null && !isUTCInstant(value.voidedAt)) errors.push('voidedAt must be a UTC ISO timestamp');
    return validationResult(errors);
}

function normalizeFinancialRecord(value, options) {
    const source = isPlainObject(value) ? value : {};
    const unknown = Object.keys(source).filter(key => FINANCIAL_RECORD_KEYS.indexOf(key) < 0);
    if (unknown.length) throw new TypeError('financial event contains unknown field: ' + unknown[0]);
    return Object.assign(normalizeEventEnvelope(source, options), {
        direction: normalizeEnum(source.direction, FINANCIAL_DIRECTION, FINANCIAL_DIRECTION.OUTFLOW),
        eventType: normalizeEnum(source.eventType, FINANCIAL_EVENT_TYPE, FINANCIAL_EVENT_TYPE.PURCHASE),
        currency: normalizeISO4217Currency(source.currency, 'CNY'),
        amountMinor: normalizeAmountMinor(source.amountMinor, 0),
    });
}

function validateFinancialRecord(value) {
    const result = validateEventEnvelope(value);
    const errors = result.errors.slice();
    if (isPlainObject(value)) {
        const unknown = Object.keys(value).filter(key => FINANCIAL_RECORD_KEYS.indexOf(key) < 0);
        if (unknown.length) errors.push('contains unknown field: ' + unknown[0]);
    }
    if (!isEnumValue(value && value.direction, FINANCIAL_DIRECTION)) errors.push('direction is invalid');
    if (!isEnumValue(value && value.eventType, FINANCIAL_EVENT_TYPE)) errors.push('eventType is invalid');
    if (!isISO4217Currency(value && value.currency)) errors.push('currency must be ISO 4217');
    if (!isAmountMinor(value && value.amountMinor)) errors.push('amountMinor must be a non-negative safe integer');
    if (value && (!isUUID(value.id) || value.id !== value.id.toLowerCase())) errors.push('id must be a lowercase UUID');
    if (value && (!isUUID(value.assetId) || value.assetId !== value.assetId.toLowerCase())) errors.push('assetId must be a lowercase UUID');
    ['correlationId', 'replacesEventId'].forEach(field => {
        if (value && value[field] != null && (!isUUID(value[field]) || value[field] !== value[field].toLowerCase())) {
            errors.push(field + ' must be a lowercase UUID or null');
        }
    });
    const requiredDirection = {
        purchase: FINANCIAL_DIRECTION.OUTFLOW,
        additionalCost: FINANCIAL_DIRECTION.OUTFLOW,
        maintenance: FINANCIAL_DIRECTION.OUTFLOW,
        subscriptionPayment: FINANCIAL_DIRECTION.OUTFLOW,
        prepaidCharge: FINANCIAL_DIRECTION.OUTFLOW,
        prepaidConsumption: FINANCIAL_DIRECTION.OUTFLOW,
        sale: FINANCIAL_DIRECTION.INFLOW,
        refund: FINANCIAL_DIRECTION.INFLOW,
        income: FINANCIAL_DIRECTION.INFLOW,
    };
    if (value && requiredDirection[value.eventType] && value.direction !== requiredDirection[value.eventType]) {
        errors.push('direction is invalid for eventType ' + value.eventType);
    }
    if (value && value.eventType === FINANCIAL_EVENT_TYPE.PREPAID_CONSUMPTION
        && (!isPlainObject(value.metadata) || value.metadata.affectsCash !== false)) {
        errors.push('prepaidConsumption metadata.affectsCash must be false');
    }
    return validationResult(errors);
}

function validateFinancialReplacementChain(events) {
    const errors = [];
    if (!Array.isArray(events)) return validationResult(['financial events must be an array']);
    const byId = new Map();
    events.forEach((event, index) => {
        if (event && byId.has(event.id)) errors.push('financialEvents[' + index + '].id duplicates another event');
        if (event) byId.set(event.id, event);
    });
    const replacementCounts = new Map();
    events.forEach((event, index) => {
        if (!event || event.replacesEventId == null) return;
        const original = byId.get(event.replacesEventId);
        if (!original) { errors.push('financialEvents[' + index + '].replacesEventId references no event'); return; }
        if (original.id === event.id) errors.push('financialEvents[' + index + '] cannot replace itself');
        if (event.eventType === FINANCIAL_EVENT_TYPE.ADJUSTMENT || original.eventType === FINANCIAL_EVENT_TYPE.ADJUSTMENT) {
            errors.push('financialEvents[' + index + '] adjustment cannot replace another event');
        }
        if (original.assetId !== event.assetId || original.currency !== event.currency) errors.push('financialEvents[' + index + '] replacement owner/currency mismatch');
        if (original.eventType !== event.eventType || original.direction !== event.direction) errors.push('financialEvents[' + index + '] replacement must preserve eventType and direction');
        if (original.voidedAt == null) errors.push('financialEvents[' + index + '] replaced original must be voided');
        if (event.voidedAt != null && !events.some(next => next && next.replacesEventId === event.id)) {
            errors.push('financialEvents[' + index + '] voided replacement must have a successor');
        }
        replacementCounts.set(original.id, (replacementCounts.get(original.id) || 0) + 1);
    });
    replacementCounts.forEach((count, id) => { if (count > 1) errors.push('financial event ' + id + ' has multiple replacements'); });
    events.forEach((event, index) => {
        const seen = new Set();
        let cursor = event;
        while (cursor && cursor.replacesEventId != null) {
            if (seen.has(cursor.id)) { errors.push('financialEvents[' + index + '] replacement chain contains a cycle'); break; }
            seen.add(cursor.id);
            cursor = byId.get(cursor.replacesEventId);
        }
    });
    return validationResult(errors);
}

function normalizeLifecycleRecord(value, options) {
    const source = isPlainObject(value) ? value : {};
    return Object.assign(normalizeEventEnvelope(source, options), {
        eventType: normalizeEnum(source.eventType, LIFECYCLE_EVENT_TYPE, LIFECYCLE_EVENT_TYPE.CREATED),
        fromStatus: normalizeEnum(source.fromStatus, ASSET_STATUS, null),
        toStatus: normalizeEnum(source.toStatus, ASSET_STATUS, null),
    });
}

function validateLifecycleRecord(value) {
    const result = validateEventEnvelope(value);
    const errors = result.errors.slice();
    if (!isEnumValue(value && value.eventType, LIFECYCLE_EVENT_TYPE)) errors.push('eventType is invalid');
    if (value && value.fromStatus != null && !isEnumValue(value.fromStatus, ASSET_STATUS)) errors.push('fromStatus is invalid');
    if (value && value.toStatus != null && !isEnumValue(value.toStatus, ASSET_STATUS)) errors.push('toStatus is invalid');
    return validationResult(errors);
}

function validateFormalLifecycleRecord(value) {
    const errors = [];
    if (!isPlainObject(value)) return validationResult(['lifecycle event must be an object']);
    const unknown = Object.keys(value).filter(key => FORMAL_LIFECYCLE_RECORD_KEYS.indexOf(key) < 0);
    if (unknown.length) errors.push('contains unknown field: ' + unknown[0]);
    const envelope = Object.assign({ metadata: {} }, value, { eventType: value.kind, fromStatus: null, toStatus: null });
    validateLifecycleRecord(envelope).errors.forEach(error => errors.push(error));
    if (value.schemaVersion !== DOMAIN_EVENT_SCHEMA_VERSION) errors.push('schemaVersion must be ' + DOMAIN_EVENT_SCHEMA_VERSION);
    if (!isPlainObject(value.details)) errors.push('details must be an object');
    if (value && (!isUUID(value.id) || value.id !== value.id.toLowerCase())) errors.push('id must be a lowercase UUID');
    if (value && (!isUUID(value.assetId) || value.assetId !== value.assetId.toLowerCase())) errors.push('assetId must be a lowercase UUID');
    ['correlationId', 'replacesEventId'].forEach(field => {
        if (value[field] != null && (!isUUID(value[field]) || value[field] !== value[field].toLowerCase())) {
            errors.push(field + ' must be a lowercase UUID or null');
        }
    });
    return validationResult(errors);
}

/** Validate the replacement/audit chain for canonical lifecycle records. */
function validateFormalLifecycleReplacementChain(events) {
    const errors = [];
    if (!Array.isArray(events)) return validationResult(['lifecycle events must be an array']);
    const byId = new Map();
    events.forEach((event, index) => {
        if (event && byId.has(event.id)) errors.push('lifecycleEvents[' + index + '].id duplicates another event');
        if (event) byId.set(event.id, event);
    });
    const replacementCounts = new Map();
    events.forEach((event, index) => {
        if (!event || event.replacesEventId == null) return;
        const original = byId.get(event.replacesEventId);
        if (!original) { errors.push('lifecycleEvents[' + index + '].replacesEventId references no event'); return; }
        if (original.id === event.id) errors.push('lifecycleEvents[' + index + '] cannot replace itself');
        if (original.assetId !== event.assetId) errors.push('lifecycleEvents[' + index + '] replacement owner mismatch');
        if (original.kind !== event.kind) errors.push('lifecycleEvents[' + index + '] replacement must preserve kind');
        if (original.voidedAt == null) errors.push('lifecycleEvents[' + index + '] replaced original must be voided');
        if (event.voidedAt != null) errors.push('lifecycleEvents[' + index + '] replacement must be active');
        replacementCounts.set(original.id, (replacementCounts.get(original.id) || 0) + 1);
    });
    replacementCounts.forEach((count, id) => { if (count > 1) errors.push('lifecycle event ' + id + ' has multiple replacements'); });
    events.forEach((event, index) => {
        const seen = new Set();
        let cursor = event;
        while (cursor && cursor.replacesEventId != null) {
            if (seen.has(cursor.id)) { errors.push('lifecycleEvents[' + index + '] replacement chain contains a cycle'); break; }
            seen.add(cursor.id);
            cursor = byId.get(cursor.replacesEventId);
        }
    });
    return validationResult(errors);
}

function normalizeSubscriptionPeriodRecord(value, options) {
    const source = isPlainObject(value) ? value : {};
    const envelope = normalizeEventEnvelope(source, options);
    return Object.assign(envelope, {
        kind: normalizeEnum(source.kind, SUBSCRIPTION_PERIOD_KIND, SUBSCRIPTION_PERIOD_KIND.BILLING),
        startDate: normalizeBusinessDate(source.startDate, envelope.effectiveDate),
        endDate: normalizeBusinessDate(source.endDate),
        paymentEventId: source.paymentEventId == null ? null : normalizeForeignKey(source.paymentEventId),
    });
}

function validateSubscriptionPeriodRecord(value) {
    const result = validateEventEnvelope(value);
    const errors = result.errors.slice();
    if (!isEnumValue(value && value.kind, SUBSCRIPTION_PERIOD_KIND)) errors.push('kind is invalid');
    if (!isBusinessDate(value && value.startDate)) errors.push('startDate must be YYYY-MM-DD');
    if (!isBusinessDate(value && value.endDate)) errors.push('endDate must be YYYY-MM-DD');
    if (isBusinessDate(value && value.startDate) && isBusinessDate(value && value.endDate)
        && value.startDate > value.endDate) errors.push('startDate must not be after endDate');
    if (value && value.paymentEventId != null && !isUUID(value.paymentEventId)) errors.push('paymentEventId must be a UUID or null');
    if (value && value.kind === SUBSCRIPTION_PERIOD_KIND.BILLING && !isUUID(value.paymentEventId)) {
        errors.push('paymentEventId is required for billing periods');
    }
    return validationResult(errors);
}

/** Inclusive business-date periods for the same asset must not overlap. Voided records are ignored. */
function validateSubscriptionPeriodsNoOverlap(records) {
    if (!Array.isArray(records)) return validationResult(['subscription periods must be an array']);
    const errors = [];
    const byAsset = {};
    records.forEach((record, index) => {
        const result = validateSubscriptionPeriodRecord(record);
        result.errors.forEach(error => errors.push('records[' + index + '].' + error));
        if (!result.valid || record.voidedAt) return;
        if (!byAsset[record.assetId]) byAsset[record.assetId] = [];
        byAsset[record.assetId].push({ index: index, startDate: record.startDate, endDate: record.endDate });
    });
    Object.keys(byAsset).forEach(assetId => {
        const periods = byAsset[assetId].sort((a, b) => a.startDate.localeCompare(b.startDate));
        for (let i = 1; i < periods.length; i++) {
            const previous = periods[i - 1];
            const current = periods[i];
            if (current.startDate <= previous.endDate) {
                errors.push('records[' + current.index + '] overlaps records[' + previous.index + '] for assetId ' + assetId);
            }
        }
    });
    return validationResult(errors);
}

// ---------------------------------------------------------------------------
// Formal asset v1 pure contract kernel.
// ---------------------------------------------------------------------------

const FORMAL_OWNED_KEYS = Object.freeze([
    'id', 'kind', 'name', 'status', 'currency',
    'acquiredOn', 'statusChangedOn', 'categoryId', 'tagIds', 'cover', 'notes',
    'createdAt', 'updatedAt', 'details',
]);
const FORMAL_WISHLIST_KEYS = Object.freeze([
    'id', 'kind', 'name', 'status', 'currency', 'categoryId', 'tagIds', 'cover', 'notes',
    'createdAt', 'updatedAt', 'wishlist',
]);
const FORMAL_WISHLIST_TARGET_GROUPS = Object.freeze(['physical', 'virtual', 'prepaid']);

// ---------------------------------------------------------------------------
// formal-v2 严格层（v0.18+）
//
// v2 数据契约在 v1 基础上去除一批非关键字段：
//   - 实物 details: 移除 dailyCostOverrideMinor
//   - 虚拟订阅 details: 与 v1 同，但 normalize 拒绝外部注入 v1 残留字段
//     （skipNextRenewal / renewalScore / usageTrackingEnabled 等）
//   - 虚拟买断 details: 移除 costGoal（仅保留 licenseAccountLabel）
//   - 种草资产: 切到极简字段集，不接受 categoryId / tagIds / notes /
//     acquiredOn / statusChangedOn / reminderPolicy / details
//   - 顶层: 移除 reminderPolicy
//
// v2 wishlist 内层 carrier kind 语义由「targetGroup 强制锁定 kind」改为：
//   kind ∈ FORMAL_ASSET_KIND（独立校验）
//   targetGroup ∈ FORMAL_WISHLIST_TARGET_GROUPS（独立校验）
//   两者无需一致；targetGroup 才是购买路由真值（physical/virtual/prepaid），
//   kind 只是上层 form 表单选择的实物形态。normalize 不再拒不一致的资产。
// ---------------------------------------------------------------------------
const FORMAL_V2_SCHEMA_GENERATION = 'formal-v2';
const FORMAL_V2_ASSET_SCHEMA_VERSION = 1;
const FORMAL_V2_DETAIL_KEYS = Object.freeze({
    physical: Object.freeze(['warrantyEndsOn', 'costGoal']),
    virtualSubscription: Object.freeze(['planName', 'accountLabel', 'billingPlan', 'autoRenew']),
    virtualPerpetual: Object.freeze(['licenseAccountLabel']),
    prepaidAmount: Object.freeze(['provider', 'expiresOn']),
    prepaidCount: Object.freeze(['provider', 'expiresOn']),
});
const FORMAL_V2_OWNED_KEYS = Object.freeze([
    'id', 'kind', 'name', 'status', 'currency',
    'acquiredOn', 'statusChangedOn', 'categoryId', 'tagIds', 'cover', 'notes',
    'createdAt', 'updatedAt', 'details',
    // v2.5.0 笔记双链阶段1：可选笔记双链字段（仅 owned；wishlist 极简 schema 不变）。
    'indexBlockId', 'relatedNotes',
    // v2.6.5 目录阶段1a：品牌/渠道可选外键（仅 owned；wishlist 极简 schema 不变）。
    'brandId', 'channelId',
]);
const FORMAL_V2_WISHLIST_KEYS = Object.freeze([
    'id', 'kind', 'name', 'status', 'currency', 'cover',
    'createdAt', 'updatedAt', 'wishlist',
]);

function formalError(message) {
    const error = new TypeError(message);
    error.code = 'FORMAL_ASSET_INVALID';
    return error;
}

function assertFormalPlainObject(value, path) {
    if (!isPlainObject(value)) throw formalError((path || 'value') + ' must be an object');
    return value;
}

function assertFormalKnownKeys(value, allowed, path) {
    const unknown = Object.keys(value).filter(key => allowed.indexOf(key) < 0);
    if (unknown.length) throw formalError((path || 'value') + ' contains unknown field: ' + unknown[0]);
}

function formalString(value, fallback, maxLength, nullable, path) {
    if (value == null && nullable) return null;
    const result = value == null ? String(fallback == null ? '' : fallback).trim() : String(value).trim();
    if (result.length > maxLength) throw formalError(path + ' is too long');
    return result;
}

function formalHasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function formalDate(value, fallback, nullable, path, provided) {
    if (provided) {
        if (value === null && nullable) return null;
        if (!isBusinessDate(value)) throw formalError(path + ' must be YYYY-MM-DD');
        return value;
    }
    if (fallback == null && nullable) return null;
    const result = normalizeBusinessDate(fallback);
    if (!result) throw formalError(path + ' must be YYYY-MM-DD');
    return result;
}

function formalInstant(value, fallback, path, provided) {
    if (provided) {
        if (!isUTCInstant(value)) throw formalError(path + ' must be a UTC ISO timestamp');
        return new Date(value).toISOString();
    }
    const result = normalizeUTCInstant(fallback);
    if (!result) throw formalError(path + ' must be a UTC ISO timestamp');
    return result;
}

function formalAmountMinor(value, fallback, positive, path) {
    const result = value == null ? fallback : value;
    if (!isAmountMinor(result) || (positive && result <= 0)) {
        throw formalError(path + ' must be a ' + (positive ? 'positive' : 'non-negative') + ' safe integer');
    }
    return result;
}

function normalizeFormalTagIds(value) {
    if (value == null) return [];
    if (!Array.isArray(value)) throw formalError('tagIds must be an array');
    const seen = new Set();
    const normalized = value.reduce((result, raw, index) => {
        if (typeof raw !== 'string' || !isUUID(raw.trim())) {
            throw formalError('tagIds[' + index + '] must be a UUID');
        }
        const id = raw.trim().toLowerCase();
        if (!seen.has(id)) {
            seen.add(id);
            result.push(id);
        }
        return result;
    }, []);
    if (normalized.length > 32) throw formalError('tagIds must contain at most 32 tags');
    return normalized;
}

// v2.6.5 目录阶段1a：品牌/渠道外键归一。null/undefined → null；合法 UUID
// trim + 小写化返回；其余 fail-closed（与 normalizeFormalTagIds 同风格）。
// path 用于错误定位（'brandId' / 'channelId'）。
function normalizeFormalDirectoryRef(value, path) {
    if (value == null) return null;
    if (typeof value !== 'string' || !isUUID(value.trim())) {
        throw formalError(path + ' must be a UUID or null');
    }
    return value.trim().toLowerCase();
}

function normalizeFormalCategoryId(kind, value) {
    if (value == null || value === '') return null;
    if (typeof value !== 'string') throw formalError('categoryId must be a string or null');
    const id = value.trim();
    const category = FORMAL_CATEGORIES.find(item => item.id === id);
    if (!category) throw formalError('categoryId is invalid');
    if (category.kinds.indexOf(kind) < 0) throw formalError('categoryId is not allowed for kind ' + kind);
    return id;
}

function normalizeFormalCover(value) {
    if (value == null) return { kind: 'none' };
    const source = assertFormalPlainObject(value, 'cover');
    const allowedByKind = {
        none: ['kind'],
        upload: ['kind', 'assetPath'],
        workspaceAsset: ['kind', 'assetPath'],
        preset: ['kind', 'presetId'],
        emoji: ['kind', 'emoji'],
    };
    const allowed = allowedByKind[source.kind];
    if (!allowed) throw formalError('cover.kind is invalid');
    assertFormalKnownKeys(source, allowed, 'cover');
    const normalized = normalizeCover(source);
    if (normalized.kind !== source.kind) throw formalError('cover is invalid');
    return normalized;
}

function formalDeepEqual(left, right) {
    if (left === right) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left) && Array.isArray(right) && left.length === right.length
            && left.every((value, index) => formalDeepEqual(value, right[index]));
    }
    if (isPlainObject(left) || isPlainObject(right)) {
        if (!isPlainObject(left) || !isPlainObject(right)) return false;
        const leftKeys = Object.keys(left).sort();
        const rightKeys = Object.keys(right).sort();
        return leftKeys.length === rightKeys.length
            && leftKeys.every((key, index) => key === rightKeys[index] && formalDeepEqual(left[key], right[key]));
    }
    return false;
}

function normalizeFormalCostGoal(value, path) {
    if (value == null) return null;
    const source = assertFormalPlainObject(value, path);
    assertFormalKnownKeys(source, ['targetDailyAmountMinor', 'targetEndsOn'], path);
    return {
        targetDailyAmountMinor: formalAmountMinor(source.targetDailyAmountMinor, null, true, path + '.targetDailyAmountMinor'),
        targetEndsOn: formalDate(source.targetEndsOn, null, true, path + '.targetEndsOn', formalHasOwn(source, 'targetEndsOn')),
    };
}

// ---------------------------------------------------------------------------
// v2.5.0 笔记双链阶段1：索引文档块 ID + 手动关联文档归一
//
// indexBlockId：该资产在索引文档中的块 ID。只接受非空 string（≤64）或 null；
// number / 空串等一律 fail-closed。≤2.4.2 存量缺键 normalize 为 null，无迁移。
// relatedNotes：手动登记的关联文档数组，元素键白名单 {id, title, addedAt}；
// id 必填非空，title 默认 ''，addedAt 缺省回退 now；按 id 去重（保留首条）。
// ---------------------------------------------------------------------------

const FORMAL_INDEX_BLOCK_ID_MAX_LENGTH = 64;
const FORMAL_RELATED_NOTE_KEYS = Object.freeze(['id', 'title', 'addedAt']);
const FORMAL_RELATED_NOTE_TITLE_MAX_LENGTH = 200;

function normalizeFormalIndexBlockId(value) {
    if (value == null) return null;
    if (typeof value !== 'string') throw formalError('indexBlockId must be a string or null');
    const id = value.trim();
    if (!id) throw formalError('indexBlockId must not be empty');
    if (id.length > FORMAL_INDEX_BLOCK_ID_MAX_LENGTH) throw formalError('indexBlockId is too long');
    return id;
}

function normalizeFormalRelatedNotes(value, options) {
    if (value == null) return [];
    if (!Array.isArray(value)) throw formalError('relatedNotes must be an array');
    const opts = options || {};
    const seen = new Set();
    return value.reduce((result, raw, index) => {
        const path = 'relatedNotes[' + index + ']';
        const source = assertFormalPlainObject(raw, path);
        assertFormalKnownKeys(source, FORMAL_RELATED_NOTE_KEYS, path);
        if (typeof source.id !== 'string' || !source.id.trim()) {
            throw formalError(path + '.id must be a non-empty string');
        }
        const id = source.id.trim();
        if (seen.has(id)) return result;
        seen.add(id);
        result.push({
            id: id,
            title: formalString(source.title, '', FORMAL_RELATED_NOTE_TITLE_MAX_LENGTH, false, path + '.title'),
            addedAt: formalInstant(source.addedAt, opts.now || new Date().toISOString(), path + '.addedAt', formalHasOwn(source, 'addedAt')),
        });
        return result;
    }, []);
}

// ---------------------------------------------------------------------------
// formal-v2 normalize/validate 严格层
//
// 设计：引用 FORMAL_V2_* 白名单与 v2 wishlist 语义。
// ---------------------------------------------------------------------------

function normalizeFormalV2Details(kind, value) {
    if (FORMAL_ASSET_KINDS.indexOf(kind) < 0) throw formalError('kind is invalid');
    const source = value == null ? {} : assertFormalPlainObject(value, 'details');
    assertFormalKnownKeys(source, FORMAL_V2_DETAIL_KEYS[kind], 'details');
    switch (kind) {
        case FORMAL_ASSET_KIND.PHYSICAL:
            return {
                warrantyEndsOn: formalDate(source.warrantyEndsOn, null, true, 'details.warrantyEndsOn', formalHasOwn(source, 'warrantyEndsOn')),
                costGoal: normalizeFormalCostGoal(source.costGoal, 'details.costGoal'),
            };
        case FORMAL_ASSET_KIND.VIRTUAL_SUBSCRIPTION: {
            const billing = source.billingPlan == null ? {} : assertFormalPlainObject(source.billingPlan, 'details.billingPlan');
            assertFormalKnownKeys(billing, ['cycle'], 'details.billingPlan');
            const cycle = billing.cycle == null ? 'monthly' : billing.cycle;
            if (FORMAL_BILLING_CYCLES.indexOf(cycle) < 0) throw formalError('details.billingPlan.cycle is invalid');
            return {
                planName: formalString(source.planName, '', 200, false, 'details.planName'),
                accountLabel: formalString(source.accountLabel, null, 200, true, 'details.accountLabel'),
                billingPlan: { cycle: cycle },
                autoRenew: source.autoRenew == null ? false : source.autoRenew,
            };
        }
        case FORMAL_ASSET_KIND.VIRTUAL_PERPETUAL:
            return {
                licenseAccountLabel: formalString(source.licenseAccountLabel, null, 200, true, 'details.licenseAccountLabel'),
            };
        case FORMAL_ASSET_KIND.PREPAID_AMOUNT:
            return {
                provider: formalString(source.provider, null, 200, true, 'details.provider'),
                expiresOn: formalDate(source.expiresOn, null, true, 'details.expiresOn', formalHasOwn(source, 'expiresOn')),
            };
        case FORMAL_ASSET_KIND.PREPAID_COUNT:
            return {
                provider: formalString(source.provider, null, 200, true, 'details.provider'),
                expiresOn: formalDate(source.expiresOn, null, true, 'details.expiresOn', formalHasOwn(source, 'expiresOn')),
            };
        default:
            throw formalError('kind is invalid');
    }
}

function normalizeFormalV2Asset(value, options) {
    const source = assertFormalPlainObject(value, 'asset');
    const opts = options || {};
    // v2: kind is validated independently as one of FORMAL_ASSET_KIND. For
    // wishlist, kind 与 targetGroup 之间无强制对应关系（详见下方 wishlist 分支）。
    if (FORMAL_ASSET_KINDS.indexOf(source.kind) < 0) throw formalError('kind is invalid');
    const kind = source.kind;
    const status = source.status == null ? ASSET_STATUS.ACTIVE : source.status;
    if (!isEnumValue(status, ASSET_STATUS)) throw formalError('status is invalid');
    if (status === ASSET_STATUS.RETIRED && kind !== FORMAL_ASSET_KIND.PHYSICAL) {
        throw formalError('retired status is only allowed for physical assets');
    }
    const wishlist = status === ASSET_STATUS.WISHLIST;
    assertFormalKnownKeys(source, wishlist ? FORMAL_V2_WISHLIST_KEYS : FORMAL_V2_OWNED_KEYS, 'asset');
    const createdAt = formalInstant(source.createdAt, opts.now || new Date().toISOString(), 'createdAt', formalHasOwn(source, 'createdAt'));
    const now = formalInstant(source.updatedAt, createdAt, 'updatedAt', formalHasOwn(source, 'updatedAt'));
    const id = source.id == null ? createStableId() : String(source.id).trim().toLowerCase();
    if (!isUUID(id)) throw formalError('id must be a lowercase UUID');
    const name = formalString(source.name, '', 200, false, 'name');
    if (!name) throw formalError('name is required');
    const currency = formalHasOwn(source, 'currency')
        ? (isISO4217Currency(source.currency) ? String(source.currency).trim().toUpperCase() : null)
        : (formalHasOwn(opts, 'currency')
            ? (isISO4217Currency(opts.currency) ? String(opts.currency).trim().toUpperCase() : null)
            : 'CNY');
    if (!currency) throw formalError('currency must be ISO 4217');

    // Wishlist path 必须只输出 FORMAL_V2_WISHLIST_KEYS 内的字段；共同字段基底
    // 不包含 categoryId / tagIds / notes（v2 wishlist 已删除）。
    const baseFields = {
        id: id,
        kind: kind,
        name: name,
        status: status,
        currency: currency,
        cover: normalizeFormalCover(source.cover),
        createdAt: createdAt,
        updatedAt: now,
    };
    if (wishlist) {
        const wish = source.wishlist == null ? {} : assertFormalPlainObject(source.wishlist, 'wishlist');
        assertFormalKnownKeys(wish, ['expectedAmountMinor', 'reason', 'targetGroup', 'heartbeatTarget'], 'wishlist');
        // wishlist.targetGroup 是 3 选 1 的购买路由真值（physical / virtual /
        // prepaid），用于决定「购买时跳到哪个表单」。wishlist.kind 是上层
        // 表单选择的实物形态（5 选 1），两者独立校验，normalize 不再因两者
        // 不一致而拒绝。
        const inferredTargetGroup = kind === FORMAL_ASSET_KIND.PHYSICAL ? 'physical'
            : (kind.indexOf('virtual') === 0 ? 'virtual' : 'prepaid');
        const targetGroup = wish.targetGroup == null ? inferredTargetGroup : wish.targetGroup;
        if (FORMAL_WISHLIST_TARGET_GROUPS.indexOf(targetGroup) < 0) {
            throw formalError('wishlist.targetGroup is invalid');
        }
        // v2.4.2 心动值：可选目标心动值（1-999 的安全整数）；null = 无目标
        // （纯计数模式）。心动计数本身不落主表，由 wishlistEvents 的 heartbeat
        // 事件流派生。旧数据缺省键 normalize 为 null，无需迁移。
        let heartbeatTarget = null;
        if (wish.heartbeatTarget != null) {
            if (!Number.isSafeInteger(wish.heartbeatTarget) || wish.heartbeatTarget < 1 || wish.heartbeatTarget > 999) {
                throw formalError('wishlist.heartbeatTarget must be null or an integer between 1 and 999');
            }
            heartbeatTarget = wish.heartbeatTarget;
        }
        return Object.assign({}, baseFields, {
            wishlist: {
                expectedAmountMinor: wish.expectedAmountMinor == null ? null
                    : formalAmountMinor(wish.expectedAmountMinor, null, false, 'wishlist.expectedAmountMinor'),
                reason: formalString(wish.reason, '', WISHLIST_REASON_MAX_LENGTH, false, 'wishlist.reason'),
                targetGroup: targetGroup,
                heartbeatTarget: heartbeatTarget,
            },
        });
    }
    const details = normalizeFormalV2Details(kind, source.details);
    // v2 owned assets must NOT carry a reminderPolicy; the whitelist
    // (FORMAL_V2_OWNED_KEYS) already excludes it, so any external injector is
    // rejected above by assertFormalKnownKeys.
    return Object.assign({}, baseFields, {
        categoryId: normalizeFormalCategoryId(kind, source.categoryId),
        tagIds: normalizeFormalTagIds(source.tagIds),
        // v2.6.5 目录阶段1a：品牌/渠道外键，缺省 null（存量缺键读取容忍见
        // validateFormalV2Asset 的 v2.6.5 块）。
        brandId: normalizeFormalDirectoryRef(source.brandId, 'brandId'),
        channelId: normalizeFormalDirectoryRef(source.channelId, 'channelId'),
        notes: formalString(source.notes, '', 5000, false, 'notes'),
        acquiredOn: formalDate(source.acquiredOn, opts.today || now, false, 'acquiredOn', formalHasOwn(source, 'acquiredOn')),
        statusChangedOn: formalDate(source.statusChangedOn, opts.today || now, false, 'statusChangedOn', formalHasOwn(source, 'statusChangedOn')),
        details: details,
        // v2.5.0 笔记双链阶段1：可选笔记双链字段，缺省 null / []（存量缺键读取容忍）。
        indexBlockId: normalizeFormalIndexBlockId(source.indexBlockId),
        relatedNotes: normalizeFormalRelatedNotes(source.relatedNotes, { now: now }),
    });
}

function newFormalV2Asset(seed, options) {
    return normalizeFormalV2Asset(seed || {}, options);
}

function validateFormalV2Asset(value) {
    try {
        const normalized = normalizeFormalV2Asset(value, { now: value && value.updatedAt, today: value && value.statusChangedOn });
        // v2.4.2 读取容忍（本契约唯一的读取容忍例外）：≤2.4.1 写入的存量
        // wishlist 资产及其事件内嵌 sourceSnapshot 的 wishlist 子对象只有 3 键
        // （无 heartbeatTarget）。读取时缺键等价 null，因此 deepEqual 的比较目标
        // 改为「value 的副本，其 wishlist 子对象末位追加 heartbeatTarget: null」；
        // 写入路径（normalize）始终输出 4 键 canonical，未知键仍 fail-closed。
        let expected = value;
        if (value.status === ASSET_STATUS.WISHLIST
            && isPlainObject(value.wishlist)
            && !Object.prototype.hasOwnProperty.call(value.wishlist, 'heartbeatTarget')) {
            expected = Object.assign({}, value, {
                wishlist: Object.assign({}, value.wishlist, { heartbeatTarget: null }),
            });
        }
        // v2.5.0 阶段1 读取容忍：≤2.4.2 写入的存量 owned 资产没有
        // indexBlockId / relatedNotes 键。读取时缺键等价 null / []；写入路径
        // （normalize）始终输出 canonical，未知键仍 fail-closed。
        if (expected.status !== ASSET_STATUS.WISHLIST
            && (!Object.prototype.hasOwnProperty.call(expected, 'indexBlockId')
                || !Object.prototype.hasOwnProperty.call(expected, 'relatedNotes'))) {
            expected = Object.assign({}, expected);
            if (!Object.prototype.hasOwnProperty.call(expected, 'indexBlockId')) expected.indexBlockId = null;
            if (!Object.prototype.hasOwnProperty.call(expected, 'relatedNotes')) expected.relatedNotes = [];
        }
        // v2.6.5 目录阶段1a 读取容忍：≤2.6.4 写入的存量 owned 资产没有
        // brandId / channelId 键。读取时缺键等价 null；写入路径（normalize）
        // 始终输出 canonical，未知键仍 fail-closed。
        if (expected.status !== ASSET_STATUS.WISHLIST
            && (!Object.prototype.hasOwnProperty.call(expected, 'brandId')
                || !Object.prototype.hasOwnProperty.call(expected, 'channelId'))) {
            expected = Object.assign({}, expected);
            if (!Object.prototype.hasOwnProperty.call(expected, 'brandId')) expected.brandId = null;
            if (!Object.prototype.hasOwnProperty.call(expected, 'channelId')) expected.channelId = null;
        }
        const exact = formalDeepEqual(normalized, expected);
        return validationResult(exact ? [] : ['asset must already be in canonical formal-v2 form']);
    } catch (error) {
        return validationResult([error && error.message ? error.message : String(error)]);
    }
}

function normalizeFormalV2AssetPatch(asset, patch) {
    const current = normalizeFormalV2Asset(asset);
    const source = assertFormalPlainObject(patch, 'patch');
    if (Object.prototype.hasOwnProperty.call(source, 'kind')) throw formalError('patch.kind cannot be changed');
    if (Object.prototype.hasOwnProperty.call(source, 'status')
        && (source.status === ASSET_STATUS.WISHLIST) !== (current.status === ASSET_STATUS.WISHLIST)) {
        throw formalError('patch.status cannot cross the wishlist/owned branch');
    }
    // v2 wishlist 不再有 categoryId / tagIds / notes 的 patch 入口；
    // reminderPolicy 已从 owned 中移除（v2 remove）。
    // v2.5.0 笔记双链阶段1：owned patch 白名单追加 indexBlockId / relatedNotes
    // （wishlist 分支不接受笔记双链字段）。
    const allowed = current.status === ASSET_STATUS.WISHLIST
        ? ['name', 'status', 'currency', 'cover', 'updatedAt', 'wishlist']
        : ['name', 'status', 'currency', 'acquiredOn', 'statusChangedOn', 'categoryId', 'tagIds', 'cover', 'notes', 'updatedAt', 'details', 'indexBlockId', 'relatedNotes', 'brandId', 'channelId'];
    assertFormalKnownKeys(source, allowed, 'patch');
    const result = Object.assign({}, source);
    if (Object.prototype.hasOwnProperty.call(source, 'details')) {
        const detailPatch = assertFormalPlainObject(source.details, 'patch.details');
        assertFormalKnownKeys(detailPatch, FORMAL_V2_DETAIL_KEYS[current.kind], 'patch.details');
        result.details = Object.assign({}, current.details, detailPatch);
        if (current.kind === FORMAL_ASSET_KIND.VIRTUAL_SUBSCRIPTION && Object.prototype.hasOwnProperty.call(detailPatch, 'billingPlan')) {
            result.details.billingPlan = Object.assign({}, current.details.billingPlan, assertFormalPlainObject(detailPatch.billingPlan, 'patch.details.billingPlan'));
        }
        if (current.kind === FORMAL_ASSET_KIND.PHYSICAL
            && Object.prototype.hasOwnProperty.call(detailPatch, 'costGoal') && detailPatch.costGoal != null) {
            result.details.costGoal = Object.assign({}, current.details.costGoal || {}, assertFormalPlainObject(detailPatch.costGoal, 'patch.details.costGoal'));
        }
    }
    if (Object.prototype.hasOwnProperty.call(source, 'wishlist')) {
        result.wishlist = Object.assign({}, current.wishlist, assertFormalPlainObject(source.wishlist, 'patch.wishlist'));
    }
    return result;
}

function mergeFormalV2AssetPatch(asset, patch, options) {
    const current = normalizeFormalV2Asset(asset);
    const normalizedPatch = normalizeFormalV2AssetPatch(current, patch);
    const opts = options || {};
    const candidate = Object.assign({}, current, normalizedPatch, {
        id: current.id,
        kind: current.kind,
        createdAt: current.createdAt,
        updatedAt: Object.prototype.hasOwnProperty.call(normalizedPatch, 'updatedAt')
            ? normalizedPatch.updatedAt : formalInstant(null, opts.now || new Date().toISOString(), 'updatedAt', false),
    });
    return normalizeFormalV2Asset(candidate, opts);
}

function createFormalV2AssetWrapper(assets, options) {
    if (!Array.isArray(assets)) throw formalError('assets must be an array');
    const opts = options || {};
    const updatedAt = formalInstant(opts.updatedAt, opts.now || new Date().toISOString(), 'updatedAt', formalHasOwn(opts, 'updatedAt'));
    return {
        schemaGeneration: FORMAL_V2_SCHEMA_GENERATION,
        schemaVersion: FORMAL_V2_ASSET_SCHEMA_VERSION,
        assets: assets.map(asset => normalizeFormalV2Asset(asset)),
        updatedAt: updatedAt,
    };
}

function validateFormalV2AssetWrapper(value) {
    const errors = [];
    if (!isPlainObject(value)) return validationResult(['wrapper must be an object']);
    const unknown = Object.keys(value).filter(key => ['schemaGeneration', 'schemaVersion', 'assets', 'updatedAt'].indexOf(key) < 0);
    if (unknown.length) errors.push('wrapper contains unknown field: ' + unknown[0]);
    // v2 严格校验：只接受 formal-v2 wrapper。任何 v1 或其他 schemaGeneration
    // 的 wrapper 由 storage 层抛 RESET_REQUIRED 处理；本函数只负责结构与字段。
    if (value.schemaGeneration !== FORMAL_V2_SCHEMA_GENERATION) errors.push('schemaGeneration must be formal-v2');
    if (value.schemaVersion !== FORMAL_V2_ASSET_SCHEMA_VERSION) errors.push('schemaVersion must be 1');
    if (!isUTCInstant(value.updatedAt)) errors.push('updatedAt must be a UTC ISO timestamp');
    if (!Array.isArray(value.assets)) errors.push('assets must be an array');
    else {
        const ids = new Set();
        value.assets.forEach((asset, index) => {
            validateFormalV2Asset(asset).errors.forEach(error => errors.push('assets[' + index + '].' + error));
            if (asset && typeof asset.id === 'string') {
                if (ids.has(asset.id)) errors.push('assets[' + index + '].id must be globally unique');
                else ids.add(asset.id);
            }
        });
    }
    return validationResult(errors);
}

// Formal-v1 semantic read boundary. All selectors require a canonical asset;
// sidecar projections are strict and never normalize malformed records silently.
const FORMAL_DISPLAY_GROUP = Object.freeze({ physical: 'physical', virtualSubscription: 'virtual', virtualPerpetual: 'virtual', prepaidAmount: 'prepaid', prepaidCount: 'prepaid' });
const FORMAL_PREPAID_TRANSACTION_TYPES = Object.freeze(['opening', 'inflow', 'outflow', 'refund', 'adjust']);
// Canonical formal-v1 prepaid sidecar record. Stage 5 storage writes this
// shape directly; legacy prepaid transaction names are intentionally rejected.
const FORMAL_PREPAID_TRANSACTION_KEYS = Object.freeze([
    'id', 'assetId', 'type', 'dimension', 'direction', 'count',
    'effectiveDate', 'occurredAt', 'createdAt', 'note', 'financialEventId',
]);

function _tryV2Asset(asset) { try { return normalizeFormalV2Asset(asset); } catch (e) { return null; } }
function assertCanonicalFormalAsset(asset) {
    const v2 = _tryV2Asset(asset);
    if (v2) return v2;
    throw formalError('asset must be canonical formal-v2');
}
function isFormalKind(value) { return FORMAL_ASSET_KINDS.indexOf(value) >= 0; }
function getFormalKind(asset) { return assertCanonicalFormalAsset(asset).kind; }
function getFormalDisplayGroup(asset) { return FORMAL_DISPLAY_GROUP[getFormalKind(asset)]; }
function getFormalAcquiredOn(asset) { const a = assertCanonicalFormalAsset(asset); return a.status === ASSET_STATUS.WISHLIST ? null : a.acquiredOn; }
function getFormalWarrantyEndsOn(asset) { const a = assertCanonicalFormalAsset(asset); return a.status !== ASSET_STATUS.WISHLIST && a.kind === FORMAL_ASSET_KIND.PHYSICAL ? a.details.warrantyEndsOn : null; }
function formalToday(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    if (isBusinessDate(value)) return value;
    if (value == null) return todayISO();
    throw formalError('today must be YYYY-MM-DD or a valid Date');
}
function formalRecords(value, key, path) {
    if (Array.isArray(value)) return value;
    if (isPlainObject(value) && Array.isArray(value[key])) return value[key];
    if (value == null) return [];
    throw formalError((path || key) + ' must be an array or wrapper');
}
function assertFormalRecordAssetId(record, assetId, path) {
    if (!record || !isUUID(record.assetId)) throw formalError(path + '.assetId must be a UUID');
    if (record.assetId !== assetId) throw formalError(path + '.assetId must equal asset.id');
}

function projectFormalSubscription(asset, periods, today) {
    let a;
    try { a = normalizeFormalV2Asset(asset); } catch (e) { a = assertCanonicalFormalAsset(asset); }
    if (a.kind !== FORMAL_ASSET_KIND.VIRTUAL_SUBSCRIPTION || a.status === ASSET_STATUS.WISHLIST) return null;
    const date = formalToday(today);
    const records = formalRecords(periods, 'records', 'subscriptionPeriods');
    const validation = validateSubscriptionPeriodsNoOverlap(records);
    if (!validation.valid) throw formalError('subscriptionPeriods are invalid: ' + validation.errors.join('; '));
    records.forEach((record, index) => assertFormalRecordAssetId(record, a.id, 'subscriptionPeriods[' + index + ']'));
    const valid = records.filter(record => !record.voidedAt).slice().sort((l, r) => l.startDate.localeCompare(r.startDate) || l.endDate.localeCompare(r.endDate));
    const currentPeriod = valid.find(period => period.startDate <= date && date <= period.endDate) || null;
    const latestPeriod = valid.length ? valid[valid.length - 1] : null;
    let state = 'pendingConfirmation';
    if (currentPeriod) state = 'subscribed';
    else if (latestPeriod && date > latestPeriod.endDate) state = a.details.autoRenew ? 'pendingConfirmation' : 'expired';
    const basis = currentPeriod || latestPeriod;
    const plannedRenewalDate = a.details.autoRenew && basis ? addBusinessDays(basis.endDate, 1) : null;
    const trialPeriod = currentPeriod && currentPeriod.kind === SUBSCRIPTION_PERIOD_KIND.TRIAL ? currentPeriod : null;
    return {
        state,
        currentPeriod: currentPeriod ? Object.assign({}, currentPeriod) : null,
        latestPeriod: latestPeriod ? Object.assign({}, latestPeriod) : null,
        plannedRenewalDate,
        isTrial: !!trialPeriod,
        trialPeriod: trialPeriod ? Object.assign({}, trialPeriod) : null,
        latestPeriodWasTrial: !!latestPeriod && latestPeriod.kind === SUBSCRIPTION_PERIOD_KIND.TRIAL,
        indeterminate: state === 'pendingConfirmation' && !latestPeriod,
    };
}
function getFormalExpiryOn(asset, periods, today) {
    const a = assertCanonicalFormalAsset(asset);
    if (a.status === ASSET_STATUS.WISHLIST) return null;
    if (a.kind === FORMAL_ASSET_KIND.PREPAID_AMOUNT || a.kind === FORMAL_ASSET_KIND.PREPAID_COUNT) return a.details.expiresOn;
    if (a.kind !== FORMAL_ASSET_KIND.VIRTUAL_SUBSCRIPTION) return null;
    const projection = projectFormalSubscription(a, periods, today);
    return projection.currentPeriod ? projection.currentPeriod.endDate : (projection.latestPeriod ? projection.latestPeriod.endDate : null);
}
/**
 * The single read-only cross-kind date projection for reminders, sorting, and
 * reports. It deliberately returns no cached asset field: each source remains
 * authoritative in its own detail/period sidecar.
 */
function getFormalNextImportantDate(asset, periods, today) {
    const a = assertCanonicalFormalAsset(asset);
    if (a.status === ASSET_STATUS.WISHLIST) return null;
    if (a.kind === FORMAL_ASSET_KIND.PHYSICAL) {
        return a.details.warrantyEndsOn ? { date: a.details.warrantyEndsOn, type: 'warranty' } : null;
    }
    if (a.kind === FORMAL_ASSET_KIND.PREPAID_AMOUNT || a.kind === FORMAL_ASSET_KIND.PREPAID_COUNT) {
        return a.details.expiresOn ? { date: a.details.expiresOn, type: 'prepaidExpiry' } : null;
    }
    if (a.kind === FORMAL_ASSET_KIND.VIRTUAL_SUBSCRIPTION) {
        const date = getFormalExpiryOn(a, periods, today);
        return date ? { date: date, type: 'subscriptionExpiry' } : null;
    }
    return null;
}
function supportsFormalCostGoal(asset) {
    const a = assertCanonicalFormalAsset(asset);
    return a.status !== ASSET_STATUS.WISHLIST && a.kind === FORMAL_ASSET_KIND.PHYSICAL;
}

function assertFormalPrepaidTransaction(record, asset, index) {
    const path = 'prepaidTransactions[' + index + ']';
    assertFormalPlainObject(record, path);
    assertFormalKnownKeys(record, FORMAL_PREPAID_TRANSACTION_KEYS, path);
    if (!isUUID(record.id)) throw formalError(path + '.id must be a UUID');
    assertFormalRecordAssetId(record, asset.id, path);
    if (!FORMAL_PREPAID_TRANSACTION_TYPES.includes(record.type)) throw formalError(path + '.type is invalid');
    if (!isBusinessDate(record.effectiveDate)) throw formalError(path + '.effectiveDate must be YYYY-MM-DD');
    const expectedDirection = record.type === 'outflow' || record.type === 'refund' ? FINANCIAL_DIRECTION.OUTFLOW : FINANCIAL_DIRECTION.INFLOW;
    if (record.type === 'adjust') {
        if (![FINANCIAL_DIRECTION.INFLOW, FINANCIAL_DIRECTION.OUTFLOW].includes(record.direction)) throw formalError(path + '.direction is required for adjust');
    } else if (record.direction !== expectedDirection) throw formalError(path + '.direction is invalid for type ' + record.type);
    if (!isUTCInstant(record.occurredAt)) throw formalError(path + '.occurredAt must be a UTC ISO timestamp');
    if (!isUTCInstant(record.createdAt)) throw formalError(path + '.createdAt must be a UTC ISO timestamp');
    if (typeof record.note !== 'string') throw formalError(path + '.note must be a string');
    if (record.financialEventId != null && !isUUID(record.financialEventId)) throw formalError(path + '.financialEventId must be a UUID or null');
    const expectedDimension = asset.kind === FORMAL_ASSET_KIND.PREPAID_AMOUNT ? 'amount' : 'count';
    if (record.dimension !== expectedDimension) throw formalError(path + '.dimension must match asset kind');
    if (expectedDimension === 'amount') {
        if (!isUUID(record.financialEventId)) throw formalError(path + '.financialEventId is required for amount transactions');
        if (formalHasOwn(record, 'count')) throw formalError(path + ' mixes amount and count dimensions');
    } else {
        if (!Number.isSafeInteger(record.count) || record.count < 0) throw formalError(path + '.count must be a non-negative safe integer');
        if (formalHasOwn(record, 'amountMinor')) throw formalError(path + ' mixes count and amount dimensions');
    }
}
function validateFormalPrepaidTransaction(record, asset) {
    try {
        const a = assertCanonicalFormalAsset(asset);
        if (![FORMAL_ASSET_KIND.PREPAID_AMOUNT, FORMAL_ASSET_KIND.PREPAID_COUNT].includes(a.kind) || a.status === ASSET_STATUS.WISHLIST) throw formalError('asset must be an owned prepaid asset');
        assertFormalPrepaidTransaction(record, a, 0);
        return validationResult([]);
    } catch (error) { return validationResult([error && error.message ? error.message : String(error)]); }
}
function projectFormalPrepaid(asset, transactions, financialEvents) {
    let a;
    try { a = normalizeFormalV2Asset(asset); } catch (e) { a = assertCanonicalFormalAsset(asset); }
    const amountKind = a.kind === FORMAL_ASSET_KIND.PREPAID_AMOUNT;
    if (!amountKind && a.kind !== FORMAL_ASSET_KIND.PREPAID_COUNT || a.status === ASSET_STATUS.WISHLIST) return null;
    const records = formalRecords(transactions, 'records', 'prepaidTransactions');
    const financialById = new Map(formalRecords(financialEvents, 'events', 'financialEvents').map(event => [event.id, event]));
    const linkedFinancialEventIds = new Set();
    let opening = 0, inflow = 0, outflow = 0, adjust = 0;
    records.forEach((record, index) => {
        assertFormalPrepaidTransaction(record, a, index);
        if (record.financialEventId != null) {
            if (linkedFinancialEventIds.has(record.financialEventId)) {
                throw formalError('prepaidTransactions[' + index + '].financialEventId is already linked to another prepaid transaction');
            }
            linkedFinancialEventIds.add(record.financialEventId);
        }
        const event = record.financialEventId == null ? null : financialById.get(record.financialEventId);
        if ((amountKind || record.financialEventId != null) && (!event || event.assetId !== a.id || event.currency !== a.currency || event.voidedAt)) {
            throw formalError('prepaidTransactions[' + index + '].financialEventId has no active matching financial event');
        }
        if (event && event.effectiveDate !== record.effectiveDate) throw formalError('prepaidTransactions[' + index + '].effectiveDate must match linked financial event');
        if (event) {
            const expectedTypes = record.type === 'opening' ? [FINANCIAL_EVENT_TYPE.PURCHASE, FINANCIAL_EVENT_TYPE.ADJUSTMENT]
                : (record.type === 'inflow' ? [FINANCIAL_EVENT_TYPE.PREPAID_CHARGE]
                    : (record.type === 'outflow' ? [FINANCIAL_EVENT_TYPE.PREPAID_CONSUMPTION]
                        : (record.type === 'refund' ? [FINANCIAL_EVENT_TYPE.REFUND] : [FINANCIAL_EVENT_TYPE.ADJUSTMENT])));
            if (expectedTypes.indexOf(event.eventType) < 0) throw formalError('prepaidTransactions[' + index + '].financialEventId has incompatible eventType');
            const expectedEventDirection = record.type === 'refund' ? FINANCIAL_DIRECTION.INFLOW
                : (record.type === 'inflow' || event.eventType === FINANCIAL_EVENT_TYPE.PURCHASE
                    ? FINANCIAL_DIRECTION.OUTFLOW : record.direction);
            if (event.direction !== expectedEventDirection) throw formalError('prepaidTransactions[' + index + '].financialEventId has incompatible direction');
            if ((record.type === 'outflow' || record.type === 'adjust' || event.eventType === FINANCIAL_EVENT_TYPE.ADJUSTMENT)
                && event.metadata.affectsCash !== false) throw formalError('prepaidTransactions[' + index + '].financialEventId must be non-cash');
        }
        const value = amountKind ? event.amountMinor : record.count;
        if (record.type === 'opening') opening += value;
        else if (record.type === 'inflow') inflow += value;
        else if (record.type === 'outflow' || record.type === 'refund') outflow += value;
        else adjust += record.direction === FINANCIAL_DIRECTION.OUTFLOW ? -value : value;
        if (![opening, inflow, outflow, adjust].every(Number.isSafeInteger)) throw formalError('prepaid projection exceeds safe integer range');
    });
    const remaining = opening + inflow - outflow + adjust;
    if (!Number.isSafeInteger(remaining)) throw formalError('prepaid projection exceeds safe integer range');
    return amountKind
        ? { dimension: 'amount', currency: a.currency, openingAmountMinor: opening, inflowAmountMinor: inflow, outflowAmountMinor: outflow, adjustAmountMinor: adjust, balanceAmountMinor: remaining, transactionCount: records.length }
        : { dimension: 'count', unitLabel: '次', openingCount: opening, inflowCount: inflow, outflowCount: outflow, adjustCount: adjust, remainingCount: remaining, transactionCount: records.length };
}

function assertFormalUsageRecord(record, index) {
    const path = 'usage[' + index + ']';
    assertFormalPlainObject(record, path);
    assertFormalKnownKeys(record, ['id', 'assetId', 'date', 'durationMinutes', 'action', 'note', 'createdAt'], path);
    if (!isUUID(record.id)) throw formalError(path + '.id must be a UUID');
    if (!isUUID(record.assetId)) throw formalError(path + '.assetId must be a UUID');
    if (!isBusinessDate(record.date)) throw formalError(path + '.date must be YYYY-MM-DD');
    if (!Number.isSafeInteger(record.durationMinutes) || record.durationMinutes < 0) throw formalError(path + '.durationMinutes must be a non-negative safe integer');
    if (typeof record.action !== 'string') throw formalError(path + '.action must be a string');
    if (typeof record.note !== 'string') throw formalError(path + '.note must be a string');
    if (!isUTCInstant(record.createdAt)) throw formalError(path + '.createdAt must be a UTC ISO timestamp');
}
function validateFormalUsageRecord(record, asset) {
    try {
        const a = assertCanonicalFormalAsset(asset);
        assertFormalUsageRecord(record, 0);
        assertFormalRecordAssetId(record, a.id, 'usage[0]');
        return validationResult([]);
    } catch (error) { return validationResult([error && error.message ? error.message : String(error)]); }
}
function projectFormalFinancials(asset, financialEvents) {
    let a;
    try { a = normalizeFormalV2Asset(asset); } catch (e) { a = assertCanonicalFormalAsset(asset); }
    if (a.status === ASSET_STATUS.WISHLIST) return null;
    if (financialEvents == null) throw formalError('financialEvents sidecar is required for financial projection');
    const reachable = formalRecords(financialEvents, 'events', 'financialEvents');
    reachable.forEach((record, index) => {
        const validation = validateFinancialRecord(record);
        if (!validation.valid) throw formalError('financialEvents[' + index + '] is invalid: ' + validation.errors.join('; '));
        assertFormalRecordAssetId(record, a.id, 'financialEvents[' + index + ']');
        if (record.currency !== a.currency) {
            throw formalError('financialEvents[' + index + '].currency is ' + record.currency + '; expected owner currency ' + a.currency);
        }
    });
    const replacementValidation = validateFinancialReplacementChain(reachable);
    if (!replacementValidation.valid) throw formalError('financialEvents replacement chain is invalid: ' + replacementValidation.errors.join('; '));
    const records = reachable.filter(record => !record.voidedAt);
    let inflowAmountMinor = 0, outflowAmountMinor = 0, acquisitionAmountMinor = 0;
    records.forEach(record => {
        try {
            if (record.direction === FINANCIAL_DIRECTION.INFLOW) inflowAmountMinor = safeMinorAdd(inflowAmountMinor, record.amountMinor);
            else outflowAmountMinor = safeMinorAdd(outflowAmountMinor, record.amountMinor);
            if (record.eventType === FINANCIAL_EVENT_TYPE.PURCHASE
                || (a.kind === FORMAL_ASSET_KIND.VIRTUAL_SUBSCRIPTION
                    && record.eventType === FINANCIAL_EVENT_TYPE.SUBSCRIPTION_PAYMENT)) {
                acquisitionAmountMinor = record.direction === FINANCIAL_DIRECTION.OUTFLOW
                    ? safeMinorAdd(acquisitionAmountMinor, record.amountMinor)
                    : safeMinorSubtract(acquisitionAmountMinor, record.amountMinor);
            } else if (record.eventType === FINANCIAL_EVENT_TYPE.ADJUSTMENT
                && record.replacesEventId == null && record.metadata && record.metadata.scope === 'acquisition') {
                acquisitionAmountMinor = record.direction === FINANCIAL_DIRECTION.OUTFLOW
                    ? safeMinorAdd(acquisitionAmountMinor, record.amountMinor)
                    : safeMinorSubtract(acquisitionAmountMinor, record.amountMinor);
            }
        } catch (error) { throw formalError('financial projection exceeds safe integer range'); }
    });
    let netAmountMinor;
    try { netAmountMinor = safeMinorSubtract(outflowAmountMinor, inflowAmountMinor); }
    catch (error) { throw formalError('financial projection exceeds safe integer range'); }
    const cashRecords = records.filter(record => !record.metadata || record.metadata.affectsCash !== false);
    let cashInflowAmountMinor = 0, cashOutflowAmountMinor = 0;
    cashRecords.forEach(record => {
        if (record.direction === FINANCIAL_DIRECTION.INFLOW) cashInflowAmountMinor = safeMinorAdd(cashInflowAmountMinor, record.amountMinor);
        else cashOutflowAmountMinor = safeMinorAdd(cashOutflowAmountMinor, record.amountMinor);
    });
    const cashNetAmountMinor = safeMinorSubtract(cashOutflowAmountMinor, cashInflowAmountMinor);
    return { currency: a.currency, acquisitionAmountMinor, netAmountMinor, cashTotals: {
        inflowAmountMinor: cashInflowAmountMinor, outflowAmountMinor: cashOutflowAmountMinor,
        netAmountMinor: cashNetAmountMinor, eventCount: cashRecords.length,
    },
        recordedTotals: { inflowAmountMinor, outflowAmountMinor, netAmountMinor, eventCount: records.length } };
}
function projectFormalCostGoal(asset, today, financialEvents) {
    let a;
    try { a = normalizeFormalV2Asset(asset); } catch (e) { a = assertCanonicalFormalAsset(asset); }
    if (!supportsFormalCostGoal(a) || a.details.costGoal == null) return null;
    const T = a.details.costGoal.targetDailyAmountMinor;
    const elapsedDays = Math.max(1, daysBetween(a.acquiredOn, formalToday(today)) + 1);
    const N = projectFormalFinancials(a, financialEvents).netAmountMinor;
    const currentDailyAmountMinor = Math.ceil(N / elapsedDays);
    const achieved = currentDailyAmountMinor <= T;
    let daysToTarget = 0;
    let targetDate = null;
    if (N > 0 && T > 0) {
        const dTarget = Math.ceil(N / T);
        daysToTarget = Math.max(0, dTarget - elapsedDays);
        targetDate = addBusinessDays(a.acquiredOn, dTarget - 1);
    }
    return { targetDailyAmountMinor: T, targetEndsOn: a.details.costGoal.targetEndsOn, currentDailyAmountMinor, achieved, daysToTarget, targetDate };
}

/**
 * 反向投影：给定目标截止日期 targetEndsOn，反算达成该日期所需的日均价。
 * 与 projectFormalCostGoal 共用口径：days = daysBetween(acquiredOn, targetEndsOn) + 1（含两端）。
 * 纯函数、无副作用。`today` 保留于签名以对齐 projectFormalCostGoal，公式本身不使用。
 * 返回 { targetDailyAmountMinor, days, valid, reason }：
 *   - valid=true  → targetDailyAmountMinor = ceil(N / days)
 *   - valid=false → targetDailyAmountMinor = null，reason ∈ {'invalid','dateBeforeAcquired','noNetCost'}
 */
function projectFormalCostGoalByDate(asset, targetEndsOn, today, financialEvents) {
    let a;
    try { a = normalizeFormalV2Asset(asset); } catch (e) { a = assertCanonicalFormalAsset(asset); }
    const fail = (reason) => ({ targetDailyAmountMinor: null, days: 0, valid: false, reason });
    if (!supportsFormalCostGoal(a)) return fail('invalid');
    const ends = parseISODate(targetEndsOn);
    const acquired = parseISODate(a.acquiredOn);
    if (!ends || !acquired) return fail('invalid');
    if (ends.getTime() < acquired.getTime()) return fail('dateBeforeAcquired');
    const days = daysBetween(a.acquiredOn, targetEndsOn) + 1;
    if (days <= 0) return fail('invalid');
    const N = projectFormalFinancials(a, financialEvents).netAmountMinor;
    if (!(N > 0)) return fail('noNetCost');
    return { targetDailyAmountMinor: Math.ceil(N / days), days, valid: true, reason: null };
}
function projectFormalAsset(asset, snapshot, today) {
    const a0 = asset;
    let a;
    try { a = normalizeFormalV2Asset(a0); } catch (e) { a = assertCanonicalFormalAsset(a0); }
    const sidecars = snapshot == null ? {} : assertFormalPlainObject(snapshot, 'snapshot');
    const wishlist = a.status === ASSET_STATUS.WISHLIST;
    return {
        id: a.id, kind: a.kind, displayGroup: FORMAL_DISPLAY_GROUP[a.kind], status: a.status, name: a.name,
        currency: a.currency, tagIds: a.tagIds.slice(), acquiredOn: wishlist ? null : a.acquiredOn,
        acquisition: wishlist ? null : { currency: a.currency, amountMinor: projectFormalFinancials(a, sidecars.financialEvents).acquisitionAmountMinor },
        warrantyEndsOn: getFormalWarrantyEndsOn(a), expiryOn: getFormalExpiryOn(a, sidecars.subscriptionPeriods, today),
        nextImportant: getFormalNextImportantDate(a, sidecars.subscriptionPeriods, today),
        costGoalSupported: supportsFormalCostGoal(a),
        costGoalConfigured: supportsFormalCostGoal(a) && a.details.costGoal != null,
        subscription: projectFormalSubscription(a, sidecars.subscriptionPeriods, today),
        prepaid: projectFormalPrepaid(a, sidecars.prepaidTransactions, sidecars.financialEvents),
        financials: wishlist ? null : projectFormalFinancials(a, sidecars.financialEvents), costGoal: wishlist ? null : projectFormalCostGoal(a, today, sidecars.financialEvents),
    };
}

function addBusinessDays(date, days) {
    const parsed = parseISODate(date);
    if (!parsed || !Number.isSafeInteger(days)) return null;
    parsed.setUTCDate(parsed.getUTCDate() + days);
    return parsed.toISOString().slice(0, 10);
}

function addBillingCycle(startDate, cycle) {
    const parsed = parseISODate(startDate);
    if (!parsed) return null;
    const months = cycle === 'yearly' ? 12 : (cycle === 'halfYearly' ? 6 : (cycle === 'quarterly' ? 3 : 1));
    const year = parsed.getUTCFullYear();
    const month = parsed.getUTCMonth() + months;
    const day = parsed.getUTCDate();
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

/** A billing period includes both endpoints: [startDate, endDate]. */
function getSubscriptionPeriodEnd(startDate, cycle) {
    const nextStart = addBillingCycle(startDate, cycle);
    return nextStart ? addBusinessDays(nextStart, -1) : null;
}

/**
 * v2.6.6：「过期订阅视同退役」统一口径判定（首页分组 / 状态筛选 / 统计 / 报表概览共用）。
 *   - status = 'retired' → true；wishlist → false。
 *   - 在役订阅投影 state === 'expired'（当期周期已结束且未开自动续费）→ true；
 *     pendingConfirmation（开自动续费到期未确认）仍算在役，维持既有设计。
 *   - 其余类型 / 投影异常一律 false（fail-open 为在役，不阻断渲染）。
 * 纯读函数：只读入参，不写任何状态。periods 可传全量记录（内部按 assetId 过滤）。
 */
function isEffectivelyRetired(asset, periods, today) {
    if (!asset) return false;
    if (asset.status === ASSET_STATUS.RETIRED) return true;
    if (asset.status !== ASSET_STATUS.ACTIVE) return false;
    if (asset.kind !== FORMAL_ASSET_KIND.VIRTUAL_SUBSCRIPTION) return false;
    try {
        const records = (Array.isArray(periods) ? periods : []).filter(record => record && record.assetId === asset.id);
        const projection = projectFormalSubscription(asset, records, today);
        return !!projection && projection.state === 'expired';
    } catch (error) { return false; }
}

function sortAssets(assets, sortId, financialEvents) {
    const list = assets.slice();
    const acquisition = asset => {
        if (!asset || asset.status === ASSET_STATUS.WISHLIST || !isFormalKind(asset.kind)) return 0;
        return projectFormalFinancials(asset, (financialEvents || []).filter(event => event && event.assetId === asset.id)).acquisitionAmountMinor;
    };
    const compareCurrencyThenAmount = (left, right, descending) => {
        const currencyOrder = String(left.currency).localeCompare(String(right.currency));
        if (currencyOrder !== 0) return currencyOrder;
        const leftAmount = acquisition(left), rightAmount = acquisition(right);
        if (leftAmount === rightAmount) return 0;
        return descending ? (leftAmount < rightAmount ? 1 : -1) : (leftAmount < rightAmount ? -1 : 1);
    };
    switch (sortId) {
        case 'newest':
            return list.sort((a, b) => (b.acquiredOn || '').localeCompare(a.acquiredOn || ''));
        case 'oldest':
            return list.sort((a, b) => (a.acquiredOn || '').localeCompare(b.acquiredOn || ''));
        case 'priceHigh':
            return list.sort((a, b) => compareCurrencyThenAmount(a, b, true));
        case 'priceLow':
            return list.sort((a, b) => compareCurrencyThenAmount(a, b, false));
        case 'nameAsc':
            return list.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-CN'));
        case 'default':
        default:
            return list.sort((a, b) => {
                const oa = STATUS_ORDER[a.status] != null ? STATUS_ORDER[a.status] : 9;
                const ob = STATUS_ORDER[b.status] != null ? STATUS_ORDER[b.status] : 9;
                if (oa !== ob) return oa - ob;
                return (b.acquiredOn || '').localeCompare(a.acquiredOn || '');
            });
    }
}

function applyFilter(assets, filter) {
    let list = assets;
    if (filter.kind && filter.kind !== 'all') {
        const kinds = Array.isArray(filter.kind) ? filter.kind : [filter.kind];
        list = list.filter(a => kinds.includes(a.kind));
    }
    // v2.6.6：状态筛选按「有效状态」口径——在役排除过期订阅，已退役包含过期订阅。
    // 订阅周期记录经 filter.subscriptionPeriods 注入（与 financialEvents 同模式），
    // 缺省时退回纯 status 字段过滤（既有测试与调用方零破坏）。
    if (filter.status && filter.status !== 'all') {
        if (filter.status === 'active') {
            const periods = Array.isArray(filter.subscriptionPeriods) ? filter.subscriptionPeriods : [];
            list = list.filter(a => a.status === 'active' && !isEffectivelyRetired(a, periods));
        } else if (filter.status === 'retired') {
            const periods = Array.isArray(filter.subscriptionPeriods) ? filter.subscriptionPeriods : [];
            list = list.filter(a => isEffectivelyRetired(a, periods));
        } else {
            list = list.filter(a => a.status === filter.status);
        }
    }
    if (filter.categoryId && filter.categoryId !== 'all') list = list.filter(a => a.categoryId === filter.categoryId);
    if (filter.search) {
        const q = filter.search.toLowerCase().trim();
        list = list.filter(a => (a.name || '').toLowerCase().includes(q));
    }
    // tagIds and filter.tagIds share the same canonical UUID domain. Selected
    // tags use OR semantics; an empty selection means no tag restriction.
    // v1.3.1-fix：原代码调用不存在的 normalizeTagIds（ReferenceError），导致标签筛选
    // 永远崩溃并污染后续所有 renderDock。改用内联轻量归一化（trim + lowercase），
    // 与 normalizeFormalTagIds 的输出格式一致，但不做严格校验/数量限制。
    if (Array.isArray(filter.tagIds) && filter.tagIds.length > 0) {
        const ids = new Set(filter.tagIds.map(id => String(id).trim().toLowerCase()));
        list = list.filter(a => Array.isArray(a.tagIds) && a.tagIds.some(id => ids.has(id)));
    }
    // v2.6.5 目录阶段1a：brandIds / channelIds 与 tagIds 同构 — UUID 数组 OR
    // 语义；空数组/非数组不过滤。仅 trim + lowercase，与
    // normalizeFormalDirectoryRef 输出格式一致，不做严格校验。
    if (Array.isArray(filter.brandIds) && filter.brandIds.length > 0) {
        const brandIds = new Set(filter.brandIds.map(id => String(id).trim().toLowerCase()));
        list = list.filter(a => a.brandId != null && brandIds.has(a.brandId));
    }
    if (Array.isArray(filter.channelIds) && filter.channelIds.length > 0) {
        const channelIds = new Set(filter.channelIds.map(id => String(id).trim().toLowerCase()));
        list = list.filter(a => a.channelId != null && channelIds.has(a.channelId));
    }
    return sortAssets(list, filter.sort || 'default', filter.financialEvents);
}

/**
 * Subscription-aware daily cost — the single source of truth shared by the list
 * card (_formalCardData), the top summary (computeStats) and the report
 * (buildFormalReport) so all three surfaces agree per asset.
 *
 * Only `virtualSubscription` may switch to a period basis:
 *   period   = subscription.currentPeriod || subscription.latestPeriod
 *              (covers subscribed / expired / pendingConfirmation; both endpoints
 *              inclusive, matching getSubscriptionPeriodEnd period semantics)
 *   days     = max(1, daysBetween(period.startDate, period.endDate) + 1)
 *   numerator= the period's non-void payment event amountMinor
 *   daily    = ceil(numerator / days)
 *
 * Every other kind — and any subscription with no usable period or whose payment
 * event is void/missing — falls back to the caller-supplied amortized numerator:
 *   ceil(cashNetAmountMinor / max(1, daysBetween(acquiredOn, referenceDate) + 1))
 * This keeps physical / prepaidAmount / prepaidCount / virtualPerpetual values
 * byte-for-byte unchanged (they always take the amortized branch).
 *
 * @param {object} input
 * @param {string} input.kind                asset kind (FORMAL_ASSET_KIND value)
 * @param {string} input.acquiredOn          YYYY-MM-DD amortized basis start
 * @param {number} input.cashNetAmountMinor  amortized numerator supplied by caller
 * @param {string|Date} input.referenceDate  amortized "today" (YYYY-MM-DD or Date)
 * @param {object|null} input.subscription   projectFormalSubscription output
 * @param {Array}  input.financialEvents     financial records to resolve paymentEventId
 * @returns {{amountMinor: number, basis: 'period'|'amortized'}}
 */
function formalDailyAmountMinor(input) {
    const opts = input || {};
    const cashNetAmountMinor = Number.isSafeInteger(opts.cashNetAmountMinor) ? opts.cashNetAmountMinor : 0;
    const amortizedDays = Math.max(1, daysBetween(opts.acquiredOn, opts.referenceDate) + 1);
    const fallback = { amountMinor: Math.ceil(cashNetAmountMinor / amortizedDays), basis: 'amortized' };
    if (opts.kind !== FORMAL_ASSET_KIND.VIRTUAL_SUBSCRIPTION) return fallback;
    const subscription = opts.subscription;
    if (!subscription) return fallback;
    const period = subscription.currentPeriod || subscription.latestPeriod;
    if (!period || !period.paymentEventId) return fallback;
    const events = Array.isArray(opts.financialEvents) ? opts.financialEvents : [];
    const payment = events.find(event => event && event.id === period.paymentEventId && !event.voidedAt);
    if (!payment || !Number.isSafeInteger(payment.amountMinor)) return fallback;
    const days = Math.max(1, daysBetween(period.startDate, period.endDate) + 1);
    return { amountMinor: Math.ceil(payment.amountMinor / days), basis: 'period' };
}

function computeStats(assets, financialEvents, subscriptionPeriods) {
    // v2.6.6：在役 / 退役分桶改按「有效状态」口径——过期订阅计入退役，不再
    // 计入在役数量与净额 / 日均聚合（与报表「净额只累计在役」口径对齐）。
    const allPeriods = subscriptionPeriods || [];
    const active = assets.filter(a => a.status === 'active' && !isEffectivelyRetired(a, allPeriods));
    const retired = assets.filter(a => isEffectivelyRetired(a, allPeriods));
    const wishlist = assets.filter(a => a.status === 'wishlist');
    const byCurrency = Object.create(null);
    const allFinancialEvents = financialEvents || [];
    active.forEach(asset => {
        if (!isFormalKind(asset.kind)) return;
        const assetEvents = allFinancialEvents.filter(event => event && event.assetId === asset.id);
        const projection = projectFormalFinancials(asset, assetEvents);
        const bucket = byCurrency[asset.currency] || { currency: asset.currency, netAmountMinor: 0, dailyAmountMinor: 0, assetCount: 0 };
        bucket.netAmountMinor = safeMinorAdd(bucket.netAmountMinor, projection.cashTotals.netAmountMinor);
        let subscription = null;
        if (asset.kind === FORMAL_ASSET_KIND.VIRTUAL_SUBSCRIPTION) {
            try {
                subscription = projectFormalSubscription(asset, allPeriods.filter(period => period && period.assetId === asset.id), todayISO());
            } catch (e) { subscription = null; }
        }
        const daily = formalDailyAmountMinor({
            kind: asset.kind,
            acquiredOn: asset.acquiredOn,
            cashNetAmountMinor: projection.cashTotals.netAmountMinor,
            referenceDate: todayISO(),
            subscription: subscription,
            financialEvents: assetEvents,
        });
        bucket.dailyAmountMinor = safeMinorAdd(bucket.dailyAmountMinor, daily.amountMinor);
        bucket.assetCount++;
        byCurrency[asset.currency] = bucket;
    });
    return {
        byCurrency: byCurrency,
        activeCount: active.length,
        retiredCount: retired.length,
        wishlistCount: wishlist.length,
        totalCount: assets.length,
    };
}

module.exports = {
    STATUSES: STATUSES,
    SORTS: SORTS,
    STATUS_MAP: STATUS_MAP,
    SORT_MAP: SORT_MAP,
    STATUS_ORDER: STATUS_ORDER,
    FORMAL_SCHEMA_GENERATION: FORMAL_SCHEMA_GENERATION,
    FORMAL_ASSET_SCHEMA_VERSION: FORMAL_ASSET_SCHEMA_VERSION,
    FORMAL_ASSET_KIND: FORMAL_ASSET_KIND,
    FORMAL_ASSET_KINDS: FORMAL_ASSET_KINDS,
    FORMAL_BILLING_CYCLES: FORMAL_BILLING_CYCLES,
    FORMAL_CATEGORIES: FORMAL_CATEGORIES,
    FORMAL_CATEGORY_IDS: FORMAL_CATEGORY_IDS,
    ASSET_STATUS: ASSET_STATUS,
    FINANCIAL_DIRECTION: FINANCIAL_DIRECTION,
    FINANCIAL_EVENT_TYPE: FINANCIAL_EVENT_TYPE,
    LIFECYCLE_EVENT_TYPE: LIFECYCLE_EVENT_TYPE,
    SUBSCRIPTION_PERIOD_KIND: SUBSCRIPTION_PERIOD_KIND,
    EVENT_SOURCE: EVENT_SOURCE,
    DOMAIN_EVENT_SCHEMA_VERSION: DOMAIN_EVENT_SCHEMA_VERSION,
    FINANCIAL_RECORD_KEYS: FINANCIAL_RECORD_KEYS,
    normalizeCover: normalizeCover,
    normalizeEventEnvelope: normalizeEventEnvelope,
    validateEventEnvelope: validateEventEnvelope,
    normalizeFinancialRecord: normalizeFinancialRecord,
    validateFinancialRecord: validateFinancialRecord,
    validateFinancialReplacementChain: validateFinancialReplacementChain,
    normalizeLifecycleRecord: normalizeLifecycleRecord,
    validateLifecycleRecord: validateLifecycleRecord,
    FORMAL_LIFECYCLE_RECORD_KEYS: FORMAL_LIFECYCLE_RECORD_KEYS,
    validateFormalLifecycleRecord: validateFormalLifecycleRecord,
    validateFormalLifecycleReplacementChain: validateFormalLifecycleReplacementChain,
    normalizeSubscriptionPeriodRecord: normalizeSubscriptionPeriodRecord,
    validateSubscriptionPeriodRecord: validateSubscriptionPeriodRecord,
    validateSubscriptionPeriodsNoOverlap: validateSubscriptionPeriodsNoOverlap,
    addBusinessDays: addBusinessDays,
    addBillingCycle: addBillingCycle,
    getSubscriptionPeriodEnd: getSubscriptionPeriodEnd,
    getFormalNextImportantDate: getFormalNextImportantDate,
    normalizeFormalTagIds: normalizeFormalTagIds,
    normalizeFormalCategoryId: normalizeFormalCategoryId,
    FORMAL_WISHLIST_TARGET_GROUPS: FORMAL_WISHLIST_TARGET_GROUPS,

    FORMAL_V2_SCHEMA_GENERATION: FORMAL_V2_SCHEMA_GENERATION,
    FORMAL_V2_ASSET_SCHEMA_VERSION: FORMAL_V2_ASSET_SCHEMA_VERSION,
    FORMAL_V2_DETAIL_KEYS: FORMAL_V2_DETAIL_KEYS,
    FORMAL_V2_OWNED_KEYS: FORMAL_V2_OWNED_KEYS,
    FORMAL_V2_WISHLIST_KEYS: FORMAL_V2_WISHLIST_KEYS,
    newFormalV2Asset: newFormalV2Asset,
    normalizeFormalV2Asset: normalizeFormalV2Asset,
    validateFormalV2Asset: validateFormalV2Asset,
    normalizeFormalV2AssetPatch: normalizeFormalV2AssetPatch,
    mergeFormalV2AssetPatch: mergeFormalV2AssetPatch,
    createFormalV2AssetWrapper: createFormalV2AssetWrapper,
    validateFormalV2AssetWrapper: validateFormalV2AssetWrapper,
    FORMAL_DISPLAY_GROUP: FORMAL_DISPLAY_GROUP,
    FORMAL_PREPAID_TRANSACTION_TYPES: FORMAL_PREPAID_TRANSACTION_TYPES,
    FORMAL_PREPAID_TRANSACTION_KEYS: FORMAL_PREPAID_TRANSACTION_KEYS,
    isFormalKind: isFormalKind,
    getFormalKind: getFormalKind,
    getFormalDisplayGroup: getFormalDisplayGroup,
    getFormalAcquiredOn: getFormalAcquiredOn,
    getFormalWarrantyEndsOn: getFormalWarrantyEndsOn,
    getFormalExpiryOn: getFormalExpiryOn,
    supportsFormalCostGoal: supportsFormalCostGoal,
    projectFormalSubscription: projectFormalSubscription,
    projectFormalPrepaid: projectFormalPrepaid,
    validateFormalPrepaidTransaction: validateFormalPrepaidTransaction,
    validateFormalUsageRecord: validateFormalUsageRecord,
    projectFormalFinancials: projectFormalFinancials,
    projectFormalCostGoal: projectFormalCostGoal,
    projectFormalCostGoalByDate: projectFormalCostGoalByDate,
    projectFormalAsset: projectFormalAsset,
    sortAssets: sortAssets,
    isEffectivelyRetired: isEffectivelyRetired,
    formalDailyAmountMinor: formalDailyAmountMinor,
    computeStats: computeStats,
    applyFilter: applyFilter,
};

},
"api/algorithms.js": function(module, exports, __require, externalRequire) {
/* eslint-disable no-undef */
/**
 * SiYuan 资产管理插件 — algorithms.js
 *
 * 已实现：
 *   - daysBetween / daysUntil / formatDate / todayISO（日期工具）
 *   - formatRemainingBadge（到期徽章，单点真相）
 *   - formatCNY（zh-CN 千分位 + 2 位小数，alias = fmtPrice，主代码仍兼容用）
 *   - currencySymbol / formatCurrency（多币种 M4：CNY / USD / EUR / GBP）
 *   - escapeHtml / genId
 *
 * 规划中（v0.15+ / v1 方案补）：
 *   - lruCache / memoize —— 1000+ 资产虚拟列表（M17）启用时实现
 *   - exchangeRateConvert —— 汇率转换（M9 + 双币种显示依赖）
 *
 * 依赖：无
 */

'use strict';

function daysBetween(a, b) {
    const da = a instanceof Date ? a : new Date(a);
    const db = b instanceof Date ? b : new Date(b);
    if (isNaN(da.getTime()) || isNaN(db.getTime())) return 0;
    const ms = db.getTime() - da.getTime();
    return Math.max(0, Math.floor(ms / 86400000));
}

/**
 * 把任意输入（YYYY-MM-DD 字符串 / Date 对象 / datetime 字符串）归一为
 * 本地日历日 YYYY-MM-DD 纯日期串。无效输入返回空串。
 * 内部 helper，不导出。
 */
function toDateString(value) {
    if (!value) return '';
    if (typeof value === 'string') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
        const dt = new Date(value);
        return isNaN(dt.getTime()) ? '' : formatDate(dt);
    }
    if (value instanceof Date) {
        return isNaN(value.getTime()) ? '' : formatDate(value);
    }
    return '';
}

/**
 * 剩余天数（endDate - today），可负值表示已过期。
 * 两端一律先归一为 YYYY-MM-DD 纯日期串，再用 UTC 零点相减，
 * 杜绝"到期日当天传 Date 对象导致差值为负小时数 → 误判已过期"的时刻陷阱。
 * 加固后 daysUntil(date, new Date()) 与 daysUntil(date, todayISO()) 结果一致。
 * @returns {number}
 */
function daysUntil(endDate, today) {
    if (!endDate) return 0;
    const endStr = toDateString(endDate);
    const todayStr = toDateString(today == null ? new Date() : today);
    if (!endStr || !todayStr) return 0;
    const de = new Date(endStr + 'T00:00:00.000Z');
    const dt = new Date(todayStr + 'T00:00:00.000Z');
    if (isNaN(de.getTime()) || isNaN(dt.getTime())) return 0;
    return Math.round((de.getTime() - dt.getTime()) / 86400000);
}

function formatDate(date) {
    if (!date) return '';
    const dt = date instanceof Date ? date : new Date(date);
    if (isNaN(dt.getTime())) return '';
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
}

function todayISO() {
    return formatDate(new Date());
}

/**
 * 到期徽章等级（方案 M3 + M9 共同依赖）。
 * @param {number} daysLeft 剩余天数（可负值）
 * @param {string} type 'subscription' | 'oneTime'
 * @param {string} t i18n 函数（可选，用于本地化标签）
 * @returns {{tier: string, label: string}}
 *   tier ∈ {'expired','urgent','soon','normal','permanent'}
 */
function formatRemainingBadge(daysLeft, type, t) {
    const _t = t || ((k, fb) => fb || k);
    if (type === 'oneTime') {
        return { tier: 'permanent', label: _t('badgePermanent', '永久') };
    }
    if (daysLeft < 0) return { tier: 'expired', label: _t('badgeExpired', '已过期') };
    if (daysLeft === 0) return { tier: 'urgent', label: _t('badgeToday', '今日到期') };
    if (daysLeft <= 7) return { tier: 'urgent', label: daysLeft + ' ' + _t('badgeDaysLeft', '天后到期') };
    if (daysLeft <= 30) return { tier: 'soon', label: daysLeft + ' ' + _t('badgeDaysLeft', '天后到期') };
    return { tier: 'normal', label: daysLeft + ' ' + _t('badgeDaysLeft', '天后到期') };
}

function formatCNY(price) {
    const n = Number(price);
    const v = Number.isFinite(n) ? n : 0;
    return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function genId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// Domain-contract primitives. Keep these independent from the current UI model.
const ISO4217_BASE_EXPONENT_2 = (
    'AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BOV BRL BSD BTN BWP BYN BZD '
    + 'CAD CDF CHE CHF CHW CLF CLP CNY COP COU CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL '
    + 'GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW '
    + 'KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MXV MYR MZN NAD '
    + 'NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP '
    + 'SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD USN UYI UYU UYW '
    + 'UZS VED VES VND VUV WST XAF XAG XAU XBA XBB XBC XBD XCD XCG XDR XOF XPD XPF XPT XSU XTS XUA XXX YER ZAR '
    + 'ZMW ZWG'
).trim().split(/\s+/);

// ISO 4217 minor-unit exponents. Most currencies use 2; only exceptions need
// to be listed. The map is the single precision truth for parsing/formatting.
const ISO4217_EXPONENTS = Object.freeze(Object.assign(
    Object.fromEntries(ISO4217_BASE_EXPONENT_2.map(code => [code, 2])),
    {
        BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0,
        PYG: 0, RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
        BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
        CLF: 4, UYW: 4,
    }
));
const ISO4217_CODES = Object.freeze(new Set(Object.keys(ISO4217_EXPONENTS)));

function currencyExponent(currency) {
    const code = normalizeISO4217Currency(currency);
    if (!code) throw new RangeError('currency must be ISO 4217');
    if (!Object.prototype.hasOwnProperty.call(ISO4217_EXPONENTS, code)) {
        throw new RangeError('currency has no known ISO 4217 minor-unit definition');
    }
    return ISO4217_EXPONENTS[code];
}

function safeMinorAdd(left, right) {
    if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) {
        throw new RangeError('minor amount operands must be safe integers');
    }
    const result = left + right;
    if (!Number.isSafeInteger(result)) throw new RangeError('minor amount exceeds safe integer range');
    return result;
}

function safeMinorSubtract(left, right) {
    return safeMinorAdd(left, -right);
}

/** Exact decimal-string parser; deliberately never uses Number(value) * factor. */
function parseMajorToMinor(value, currency) {
    const text = String(value == null ? '' : value).trim();
    if (!/^\d+(?:\.\d+)?$/.test(text)) throw new RangeError('amount format is invalid');
    const exponent = currencyExponent(currency);
    const parts = text.split('.');
    const fraction = parts[1] || '';
    if (fraction.length > exponent) throw new RangeError('amount exceeds currency precision');
    const digits = (parts[0].replace(/^0+(?=\d)/, '') || '0') + fraction.padEnd(exponent, '0');
    const amount = Number(digits);
    if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError('amount exceeds safe integer range');
    return amount;
}

function minorToMajorString(value, currency) {
    if (!isAmountMinor(value)) throw new RangeError('amountMinor must be a non-negative safe integer');
    const exponent = currencyExponent(currency);
    if (exponent === 0) return String(value);
    const digits = String(value).padStart(exponent + 1, '0');
    const result = digits.slice(0, -exponent) + '.' + digits.slice(-exponent);
    return result.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function formatAmountMinor(value, currency, locale) {
    if (!isAmountMinor(value)) throw new RangeError('amountMinor must be a non-negative safe integer');
    const code = normalizeISO4217Currency(currency);
    const exponent = currencyExponent(code);
    const digits = String(value).padStart(exponent + 1, '0');
    const integerDigits = exponent === 0 ? digits : digits.slice(0, -exponent);
    const fractionDigits = exponent === 0 ? '' : digits.slice(-exponent);
    const targetLocale = locale || 'en-US';
    const integerParts = new Intl.NumberFormat(targetLocale, { useGrouping: true, maximumFractionDigits: 0 })
        .formatToParts(BigInt(integerDigits));
    const groupedInteger = integerParts.filter(part => part.type === 'integer' || part.type === 'group')
        .map(part => part.value).join('');
    // Prefer narrowSymbol so CNY renders as the bare ¥ glyph (without the CN
    // prefix) under en-US. Very old engines that reject currencyDisplay fall
    // back to a clean symbol + grouped number.
    let currencyParts;
    try {
        currencyParts = new Intl.NumberFormat(targetLocale, {
            style: 'currency', currency: code, currencyDisplay: 'narrowSymbol',
            minimumFractionDigits: exponent, maximumFractionDigits: exponent,
        }).formatToParts(0n);
    } catch (e) {
        const decimalSep = exponent > 0
            ? (new Intl.NumberFormat(targetLocale, { minimumFractionDigits: exponent, maximumFractionDigits: exponent }).formatToParts(0).find(part => part.type === 'decimal') || { value: '.' }).value
            : '';
        return currencySymbol(code) + groupedInteger + (exponent > 0 ? decimalSep + fractionDigits : '');
    }
    const numericTypes = new Set(['integer', 'group', 'decimal', 'fraction']);
    const firstNumeric = currencyParts.findIndex(part => numericTypes.has(part.type));
    let lastNumeric = currencyParts.length - 1;
    while (lastNumeric >= 0 && !numericTypes.has(currencyParts[lastNumeric].type)) lastNumeric--;
    const prefix = currencyParts.slice(0, firstNumeric).map(part => part.value).join('');
    const suffix = currencyParts.slice(lastNumeric + 1).map(part => part.value).join('');
    const decimal = exponent > 0
        ? (currencyParts.find(part => part.type === 'decimal') || { value: '.' }).value + fractionDigits
        : '';
    return prefix + groupedInteger + decimal + suffix;
}

function getWebCrypto() {
    if (typeof globalThis === 'undefined' || !globalThis.crypto) return null;
    return globalThis.crypto;
}

function createUuidV4Fallback() {
    const bytes = new Uint8Array(16);
    const webCrypto = getWebCrypto();
    if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
        webCrypto.getRandomValues(bytes);
    } else {
        // Legacy WebViews without Web Crypto retain uniqueness but cannot provide cryptographic entropy.
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16)
        + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}

/** Stable domain identifier: native UUID first, RFC 4122 v4 fallback otherwise. */
function createStableId() {
    const webCrypto = getWebCrypto();
    if (webCrypto && typeof webCrypto.randomUUID === 'function') {
        try { return webCrypto.randomUUID(); } catch (e) {}
    }
    return createUuidV4Fallback();
}

/** RFC 4122 UUID with an explicit version and variant. */
function isUUID(value) {
    return typeof value === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isForeignKey(value) {
    return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 200;
}

function normalizeForeignKey(value, fallback) {
    if (!isForeignKey(value)) return fallback == null ? null : fallback;
    const normalized = value.trim();
    // Foreign keys may be legacy asset ids or domain UUIDs. Only canonicalize the
    // UUID form so case-sensitive legacy asset ids retain their identity.
    return isUUID(normalized) ? normalized.toLowerCase() : normalized;
}

function enumValues(enumLike) {
    if (Array.isArray(enumLike)) return enumLike;
    return enumLike && typeof enumLike === 'object' ? Object.keys(enumLike).map(key => enumLike[key]) : [];
}

function isEnumValue(value, enumLike) {
    return enumValues(enumLike).indexOf(value) >= 0;
}

function normalizeEnum(value, enumLike, fallback) {
    return isEnumValue(value, enumLike) ? value : fallback;
}

function isBusinessDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parts = value.split('-').map(Number);
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return date.getUTCFullYear() === parts[0]
        && date.getUTCMonth() === parts[1] - 1
        && date.getUTCDate() === parts[2];
}

function normalizeBusinessDate(value, fallback) {
    if (isBusinessDate(value)) return value;
    if (fallback == null) return null;
    if (isBusinessDate(fallback)) return fallback;
    const date = fallback instanceof Date ? fallback : new Date(fallback);
    return isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function isUTCInstant(value) {
    if (typeof value !== 'string') return false;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/.exec(value);
    if (!match) return false;
    const date = new Date(value);
    if (isNaN(date.getTime())) return false;
    return date.getUTCFullYear() === Number(match[1])
        && date.getUTCMonth() + 1 === Number(match[2])
        && date.getUTCDate() === Number(match[3])
        && date.getUTCHours() === Number(match[4])
        && date.getUTCMinutes() === Number(match[5])
        && date.getUTCSeconds() === Number(match[6]);
}

function normalizeUTCInstant(value, fallback) {
    if (isUTCInstant(value)) return new Date(value).toISOString();
    if (fallback == null) return null;
    const date = fallback instanceof Date ? fallback : new Date(fallback);
    return isNaN(date.getTime()) ? null : date.toISOString();
}

function isISO4217Currency(value) {
    return typeof value === 'string' && ISO4217_CODES.has(value.trim().toUpperCase());
}

function normalizeISO4217Currency(value, fallback) {
    const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (isISO4217Currency(normalized)) return normalized;
    return isISO4217Currency(fallback) ? String(fallback).toUpperCase() : null;
}

function isAmountMinor(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function normalizeAmountMinor(value, fallback) {
    const parsed = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
    if (isAmountMinor(parsed)) return parsed;
    return isAmountMinor(fallback) ? fallback : 0;
}

/**
 * v0.15-T6：货币符号（仅支持 CNY / USD / EUR / GBP，未知币种 fallback CNY）
 * @param {string} currency 'CNY' | 'USD' | 'EUR' | 'GBP'
 * @returns {string} '¥' | '$' | '€' | '£'
 */
function currencySymbol(currency) {
    switch (currency) {
        case 'USD': return '$';
        case 'EUR': return '€';
        case 'GBP': return '£';
        case 'CNY':
        default: return '¥';
    }
}

/**
 * v0.15-T6：格式化金额（千分位 + 2 位小数 + 货币符号）
 * @param {number} price
 * @param {string} currency 'CNY' | 'USD' | 'EUR' | 'GBP'
 * @returns {string} e.g. '¥1,234.50' / '$1,234.50'
 */
function formatCurrency(price, currency) {
    const n = Number(price) || 0;
    return currencySymbol(currency) + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------- Exchange-rate conversion (display-layer projection, never persisted) ----------

/** Built-in reference rate: 1 USD = 7.20 CNY. Used only when no user rate exists. */
const DEFAULT_USD_CNY_RATE = 7.20;

/**
 * Convert an amount (minor units) to CNY minor units using the supplied rates object.
 *
 * ratesObj shape: { schemaVersion, baseCurrency, rates: { <CUR>: positiveFiniteNumber }, updatedAt? }
 * rates[X] semantics: 1 baseCurrency (CNY) buys X units of foreign currency.
 * Therefore foreign → CNY factor = 1 / rates[currency].
 *
 * @param {number} amountMinor  Safe integer (may be negative for net refunds).
 * @param {string} currency     ISO 4217 code of the source amount.
 * @param {object} ratesObj     Exchange-rates sidecar payload (read-only).
 * @returns {{ cnyMinor: number, cnyPerUnit: number, isFallback: boolean } | null}
 *   null when no rate is available (currency is neither base nor USD with fallback).
 */
function convertToCNYMinor(amountMinor, currency, ratesObj) {
    if (!Number.isSafeInteger(amountMinor)) return null;
    const cur = normalizeISO4217Currency(currency);
    if (!cur) return null;
    const base = (ratesObj && normalizeISO4217Currency(ratesObj.baseCurrency)) || 'CNY';
    // Identity: source currency equals the base currency (typically CNY).
    if (cur === base) return { cnyMinor: amountMinor, cnyPerUnit: 1, isFallback: false };
    // User-provided rate.
    const rates = (ratesObj && ratesObj.rates && typeof ratesObj.rates === 'object' && !Array.isArray(ratesObj.rates))
        ? ratesObj.rates : {};
    const rate = rates[cur];
    if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
        const cnyPerUnit = 1 / rate;
        const cnyMinor = Math.sign(amountMinor) * Math.round(Math.abs(amountMinor * cnyPerUnit));
        return { cnyMinor: cnyMinor, cnyPerUnit: cnyPerUnit, isFallback: false };
    }
    // Built-in USD fallback (no user rate set).
    if (cur === 'USD') {
        const cnyPerUnit = DEFAULT_USD_CNY_RATE;
        const cnyMinor = Math.sign(amountMinor) * Math.round(Math.abs(amountMinor * cnyPerUnit));
        return { cnyMinor: cnyMinor, cnyPerUnit: cnyPerUnit, isFallback: true };
    }
    // No rate available for this currency.
    return null;
}

/**
 * Format a small "≈ ¥x,xxx.xx" hint for non-CNY amounts.
 * Returns '' when currency is the base currency (no conversion needed) or no rate exists.
 */
function formatCNYApproxHint(amountMinor, currency, ratesObj) {
    const cur = normalizeISO4217Currency(currency);
    if (!cur) return '';
    const base = (ratesObj && normalizeISO4217Currency(ratesObj.baseCurrency)) || 'CNY';
    if (cur === base) return '';
    const result = convertToCNYMinor(amountMinor, currency, ratesObj);
    if (!result) return '';
    const abs = Math.abs(result.cnyMinor);
    if (!Number.isSafeInteger(abs)) return '';
    const formatted = formatAmountMinor(abs, 'CNY');
    return (result.cnyMinor < 0 ? '-' : '') + '≈ ' + formatted;
}

module.exports = {
    daysBetween: daysBetween,
    daysUntil: daysUntil,
    formatDate: formatDate,
    todayISO: todayISO,
    formatRemainingBadge: formatRemainingBadge,
    formatCNY: formatCNY,
    currencySymbol: currencySymbol,
    formatCurrency: formatCurrency,
    escapeHtml: escapeHtml,
    genId: genId,
    ISO4217_CODES: ISO4217_CODES,
    createStableId: createStableId,
    createUuidV4Fallback: createUuidV4Fallback,
    isUUID: isUUID,
    isForeignKey: isForeignKey,
    normalizeForeignKey: normalizeForeignKey,
    isEnumValue: isEnumValue,
    normalizeEnum: normalizeEnum,
    isBusinessDate: isBusinessDate,
    normalizeBusinessDate: normalizeBusinessDate,
    isUTCInstant: isUTCInstant,
    normalizeUTCInstant: normalizeUTCInstant,
    isISO4217Currency: isISO4217Currency,
    normalizeISO4217Currency: normalizeISO4217Currency,
    isAmountMinor: isAmountMinor,
    normalizeAmountMinor: normalizeAmountMinor,
    ISO4217_EXPONENTS: ISO4217_EXPONENTS,
    currencyExponent: currencyExponent,
    safeMinorAdd: safeMinorAdd,
    safeMinorSubtract: safeMinorSubtract,
    parseMajorToMinor: parseMajorToMinor,
    minorToMajorString: minorToMajorString,
    formatAmountMinor: formatAmountMinor,
    DEFAULT_USD_CNY_RATE: DEFAULT_USD_CNY_RATE,
    convertToCNYMinor: convertToCNYMinor,
    formatCNYApproxHint: formatCNYApproxHint,
};

},
"api/media.js": function(module, exports, __require, externalRequire) {
/* eslint-disable no-undef */
/**
 * SiYuan 资产管理插件 — media.js
 *
 * 资产封面媒体：工作空间图片上传、预设图标与 emoji 的统一模型。
 * 封面上传统一落盘 data/public/（思源 v2.9.3+ 静态服务目录，不参与未引用资源扫描），
 * 旧 assets/ 落盘路径经运行时翻译层（resolvePhysicalAssetPath）兼容。
 * 本批次：新增 decodeCoverImage / cropAndEncodeCoverImage / processCoverImage 提供 1:1 裁切 + 自动压缩；
 *         新流程产 Blob 直接给 uploadImage（落盘到 public/，自动压缩在 UI 端完成）。
 */

'use strict';

const MEDIA_ROOT = 'public/siyuan-plugin-asset-management';
// Uploads created before the public/ migration recorded the legacy assets/ prefix in
// persisted cover data. That data is never rewritten; the runtime translation layer
// below resolves the legacy prefix once the directory has been moved.
const LEGACY_MEDIA_ROOT = 'assets/siyuan-plugin-asset-management';
let legacyMediaMigrated = false;
const WORKSPACE_DATA_ROOT = 'data/';
const PRESET_ICON_ROOT = 'assets/preset-icons';
const DEFAULT_PRESET_ICON_ID = 'icons8-box';
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const COVER_MAX_DIMENSION = 1280;
const COVER_QUALITY = 0.92;
const COVER_COMPRESSED_THRESHOLD = 1024 * 1024;
const COVER_QUALITY_LADDER = [0.92, 0.82, 0.75];
const COVER_DEFAULT_OUTPUT_SIZE = 1280;
const ALLOWED_IMAGE_TYPES = Object.freeze({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
});
const ALLOWED_IMAGE_EXTENSIONS = Object.freeze({
    jpg: 'jpg',
    jpeg: 'jpg',
    png: 'png',
    webp: 'webp',
});
const COVER_KINDS = Object.freeze({
    UPLOAD: 'upload',
    WORKSPACE_ASSET: 'workspaceAsset',
    PRESET: 'preset',
    EMOJI: 'emoji',
    NONE: 'none',
});

function mediaError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function getFileExtension(name) {
    const match = String(name || '').trim().toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : '';
}

function normalizeWorkspaceAssetPath(value) {
    const path = String(value || '').trim().replace(/^\/+/, '');
    if (!path || (path.indexOf('assets/') !== 0 && path.indexOf('public/') !== 0)
        || /(^|\/)\.\.?(\/|$)/.test(path) || /[?#\\]/.test(path)) {
        return null;
    }
    return path;
}

function isLegacyMediaMigrated() {
    return legacyMediaMigrated;
}

// Runtime translation layer: persisted cover records keep their historical assets/
// prefix (formal-v2 data is never rewritten). Once the legacy root has been moved,
// resolve the plugin's own legacy paths to the new public/ root. Any other assets/
// path (user workspaceAsset covers) is always returned unchanged.
function resolvePhysicalAssetPath(assetPath) {
    const path = String(assetPath || '').trim();
    if (!legacyMediaMigrated) return path;
    const legacyPrefix = LEGACY_MEDIA_ROOT + '/';
    if (path.indexOf(legacyPrefix) !== 0) return path;
    return MEDIA_ROOT + '/' + path.slice(legacyPrefix.length);
}

// Covers persist paths relative to SiYuan's data directory so they resolve through
// /assets/* or /public/*. The file APIs instead address paths from the workspace root.
function toWorkspaceFilePath(assetPath) {
    const normalized = normalizeWorkspaceAssetPath(assetPath);
    return normalized ? WORKSPACE_DATA_ROOT + resolvePhysicalAssetPath(normalized) : null;
}

function normalizePresetId(value) {
    const presetId = String(value || '').trim();
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(presetId) ? presetId : null;
}

function isLegacyIconParkPreset(value) {
    return /^ip-outline-[a-z0-9-]+$/i.test(String(value || '').trim());
}

function normalizePresetCoverId(value) {
    const presetId = normalizePresetId(value);
    if (!presetId) return null;
    // IconPark artwork is no longer bundled. Keep historical assets readable by
    // explicitly switching their former preset selection to the neutral Box icon.
    return isLegacyIconParkPreset(presetId) ? DEFAULT_PRESET_ICON_ID : presetId;
}

function normalizeEmoji(value) {
    const emoji = String(value || '').trim();
    // Historical SVG symbol ids are ASCII. Only retain visibly non-ASCII emoji-like values.
    return emoji && emoji.length <= 32 && /[^\x00-\x7F]/.test(emoji) ? emoji : null;
}

function isMediaAssetId(value) {
    return /^[A-Za-z0-9_-]{1,128}$/.test(String(value || '').trim());
}

function isMediaUuid(value) {
    return /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(String(value || '').trim().toLowerCase());
}

/** Only files created by this plugin for this exact asset may be mutated. */
function isOwnedMediaPath(value, assetId) {
    const path = String(value || '').trim();
    const id = String(assetId || '').trim();
    if (!isMediaAssetId(id)) return false;
    const match = path.match(/^(assets|public)\/siyuan-plugin-asset-management\/([A-Za-z0-9_-]{1,128})\/([a-f0-9-]{36})\.(jpg|jpeg|png|webp)$/i);
    return !!match && match[2] === id && isMediaUuid(match[3]);
}

function normalizeCover(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const kind = source.kind;
    if (kind === COVER_KINDS.UPLOAD) {
        const assetPath = normalizeWorkspaceAssetPath(source.assetPath);
        return assetPath ? { kind: COVER_KINDS.UPLOAD, assetPath: assetPath } : { kind: COVER_KINDS.NONE };
    }
    if (kind === COVER_KINDS.WORKSPACE_ASSET) {
        const assetPath = normalizeWorkspaceAssetPath(source.assetPath);
        return assetPath ? { kind: COVER_KINDS.WORKSPACE_ASSET, assetPath: assetPath } : { kind: COVER_KINDS.NONE };
    }
    if (kind === COVER_KINDS.PRESET) {
        const presetId = normalizePresetCoverId(source.presetId);
        return presetId ? { kind: COVER_KINDS.PRESET, presetId: presetId } : { kind: COVER_KINDS.NONE };
    }
    if (kind === COVER_KINDS.EMOJI) {
        const emoji = normalizeEmoji(source.emoji);
        return emoji ? { kind: COVER_KINDS.EMOJI, emoji: emoji } : { kind: COVER_KINDS.NONE };
    }
    if (kind === COVER_KINDS.NONE) return { kind: COVER_KINDS.NONE };
    return { kind: COVER_KINDS.NONE };
}

function isUploadCover(cover) {
    return !!cover && cover.kind === COVER_KINDS.UPLOAD && !!normalizeWorkspaceAssetPath(cover.assetPath);
}

function isWorkspaceAssetCover(cover) {
    return !!cover && cover.kind === COVER_KINDS.WORKSPACE_ASSET && !!normalizeWorkspaceAssetPath(cover.assetPath);
}

function isOwnedUploadCover(cover, assetId) {
    return !!cover && cover.kind === COVER_KINDS.UPLOAD && isOwnedMediaPath(cover.assetPath, assetId);
}

function resolveCoverUrl(cover, presetManifest) {
    const normalized = normalizeCover(cover);
    if (normalized.kind === COVER_KINDS.UPLOAD || normalized.kind === COVER_KINDS.WORKSPACE_ASSET) {
        return '/' + resolvePhysicalAssetPath(normalized.assetPath);
    }
    if (normalized.kind !== COVER_KINDS.PRESET) return null;
    const manifest = presetManifest && typeof presetManifest === 'object' ? presetManifest : {};
    const items = Array.isArray(manifest.icons) ? manifest.icons : [];
    const item = items.find(icon => icon && icon.id === normalized.presetId);
    const filename = item && String(item.filename || '').trim();
    // Box is the only built-in default and must remain available while the
    // manifest request is pending or has failed.
    if ((!filename || /[\\/]/.test(filename)) && normalized.presetId === DEFAULT_PRESET_ICON_ID) {
        return '/plugins/siyuan-plugin-asset-management/' + PRESET_ICON_ROOT + '/icons8-box-64.png';
    }
    if (!filename || /[\\/]/.test(filename)) return null;
    return '/plugins/siyuan-plugin-asset-management/' + PRESET_ICON_ROOT + '/' + filename;
}

function createMediaPath(assetId, extension, uuid) {
    const id = String(assetId || '').trim();
    const ext = ALLOWED_IMAGE_EXTENSIONS[String(extension || '').toLowerCase()];
    const token = String(uuid || '').trim().toLowerCase();
    if (!isMediaAssetId(id)) throw mediaError('MEDIA_ASSET_ID_INVALID', 'Invalid asset id for media upload');
    if (!ext) throw mediaError('MEDIA_EXTENSION_INVALID', 'Unsupported image extension');
    if (!isMediaUuid(token)) {
        throw mediaError('MEDIA_UUID_INVALID', 'Invalid media upload id');
    }
    return MEDIA_ROOT + '/' + id + '/' + token + '.' + ext;
}

function createUploadId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const random = Math.floor(Math.random() * 16);
        return (c === 'x' ? random : ((random & 0x3) | 0x8)).toString(16);
    });
}

/** A short-lived UI upload session; cancellation does not abort the kernel request. */
function createUploadSession() {
    return { type: 'cover-upload-session', cancelled: false };
}

function cancelUploadSession(session) {
    if (!session || session.type !== 'cover-upload-session') return false;
    session.cancelled = true;
    return true;
}

function isUploadSessionActive(session) {
    return !!session && session.type === 'cover-upload-session' && session.cancelled !== true;
}

function validateImageFile(file) {
    if (!file || typeof file !== 'object') throw mediaError('MEDIA_FILE_REQUIRED', 'Image file is required');
    const size = Number(file.size);
    if (!Number.isFinite(size) || size < 0 || size > MAX_UPLOAD_BYTES) {
        throw mediaError('MEDIA_FILE_SIZE_INVALID', 'Image must not exceed 5 MiB');
    }
    const mimeType = String(file.type || '').toLowerCase();
    const extension = getFileExtension(file.name);
    const mimeExtension = ALLOWED_IMAGE_TYPES[mimeType];
    const nameExtension = ALLOWED_IMAGE_EXTENSIONS[extension];
    if ((mimeType && !mimeExtension) || (extension && !nameExtension) || (!mimeExtension && !nameExtension)) {
        throw mediaError('MEDIA_FILE_TYPE_INVALID', 'Only JPEG, PNG, and WebP images are supported');
    }
    if (mimeExtension && nameExtension && mimeExtension !== nameExtension) {
        throw mediaError('MEDIA_FILE_TYPE_INVALID', 'Image MIME type does not match its filename');
    }
    return { extension: mimeExtension || nameExtension, size: size };
}

function createCoverCanvas(width, height) {
    const w = width;
    const h = height;
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return canvas;
}

function drawCroppedToCanvas(ctx, source, crop, outW, outH) {
    const sourceWidth = Number(source && source.width);
    const sourceHeight = Number(source && source.height);
    const cropX = Math.max(0, Math.min(Number(crop.x), sourceWidth));
    const cropY = Math.max(0, Math.min(Number(crop.y), sourceHeight));
    const cropW = Math.max(0, Math.min(Number(crop.width), sourceWidth - cropX));
    const cropH = Math.max(0, Math.min(Number(crop.height), sourceHeight - cropY));
    ctx.drawImage(source, cropX, cropY, cropW, cropH, 0, 0, outW, outH);
}

function encodeCanvasToBlob(canvas, type, quality) {
    const encodeQuality = type === 'image/png' ? undefined : quality;
    if (typeof canvas.convertToBlob === 'function') {
        return canvas.convertToBlob({ type: type, quality: encodeQuality });
    }
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob
        ? resolve(blob)
        : reject(mediaError('MEDIA_ENCODE_FAILED', 'canvas.toBlob returned null')),
    type, encodeQuality));
}

async function decodeCoverImage(file, options) {
    const opts = options || {};
    const bitmapFn = opts.createImageBitmap || (typeof createImageBitmap !== 'undefined' ? createImageBitmap : null);
    if (typeof bitmapFn !== 'function') throw mediaError('MEDIA_DECODE_FAILED', 'Unable to decode image');
    let bitmap;
    try {
        bitmap = await bitmapFn(file, { imageOrientation: 'from-image' });
    } catch (e) {
        throw mediaError('MEDIA_DECODE_FAILED', 'Unable to decode image');
    }
    if (!bitmap || typeof bitmap.width !== 'number' || typeof bitmap.height !== 'number') {
        try { bitmap && bitmap.close && bitmap.close(); } catch (_) {}
        throw mediaError('MEDIA_DECODE_FAILED', 'Unable to decode image');
    }
    return { bitmap: bitmap, width: bitmap.width, height: bitmap.height };
}

async function cropAndEncodeCoverImage(options) {
    const opts = options || {};
    const bitmap = opts.bitmap;
    const sourceWidth = Number(opts.sourceWidth);
    const sourceHeight = Number(opts.sourceHeight);
    const crop = opts.crop || {};
    if (!bitmap) throw mediaError('MEDIA_DECODE_FAILED', 'Bitmap missing');
    if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
        throw mediaError('MEDIA_CROP_INVALID', 'Invalid source dimensions');
    }
    const cropX = Number(crop.x);
    const cropY = Number(crop.y);
    const cropW = Number(crop.width);
    const cropH = Number(crop.height);
    if (!Number.isFinite(cropX) || !Number.isFinite(cropY) || !Number.isFinite(cropW) || !Number.isFinite(cropH)) {
        throw mediaError('MEDIA_CROP_INVALID', 'Invalid crop coordinates');
    }
    if (cropW !== cropH) throw mediaError('MEDIA_CROP_INVALID', 'Cover crop must be 1:1');
    if (cropX < 0 || cropY < 0 || cropW <= 0 || cropH <= 0 || cropX + cropW > sourceWidth || cropY + cropH > sourceHeight) {
        throw mediaError('MEDIA_CROP_INVALID', 'Crop exceeds source bounds');
    }
    const outputSize = Number(opts.outputSize) || COVER_DEFAULT_OUTPUT_SIZE;
    const maxDimension = Number(opts.maxDimension) || COVER_MAX_DIMENSION;
    const threshold = Number(opts.threshold) || COVER_COMPRESSED_THRESHOLD;
    const type = opts.type || 'image/jpeg';
    const isPng = type === 'image/png';
    const requestedQuality = Number.isFinite(opts.quality) ? opts.quality : COVER_QUALITY;
    const finalDimension = Math.max(1, Math.min(outputSize, maxDimension));
    const outW = finalDimension;
    const outH = finalDimension;
    let canvas;
    try {
        canvas = createCoverCanvas(outW, outH);
    } catch (e) {
        throw mediaError('MEDIA_ENCODE_FAILED', 'Failed to create canvas');
    }
    const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (!ctx) throw mediaError('MEDIA_ENCODE_FAILED', '2D context unavailable');
    const drawOnce = (q) => {
        try {
            ctx.clearRect(0, 0, outW, outH);
            drawCroppedToCanvas(ctx, bitmap, { x: cropX, y: cropY, width: cropW, height: cropH }, outW, outH);
        } catch (e) {
            throw mediaError('MEDIA_ENCODE_FAILED', 'drawImage failed');
        }
        return encodeCanvasToBlob(canvas, type, isPng ? undefined : q);
    };
    let blob;
    let usedQuality = requestedQuality;
    try {
        blob = await drawOnce(requestedQuality);
    } catch (e) {
        if (e && e.code) throw e;
        throw mediaError('MEDIA_ENCODE_FAILED', 'encode failed');
    }
    let processedSize = blob.size;
    if (!isPng && blob.size > threshold) {
        const ladder = COVER_QUALITY_LADDER;
        const startIdx = ladder.indexOf(requestedQuality);
        const retryList = startIdx >= 0 ? ladder.slice(startIdx + 1) : ladder.slice(1);
        for (const q of retryList) {
            let next;
            try { next = await drawOnce(q); } catch (e) { continue; }
            processedSize = next.size;
            usedQuality = q;
            blob = next;
            if (next.size <= threshold) break;
        }
    }
    const sourceSize = Number(opts.sourceSize) || 0;
    const compressed = processedSize < sourceSize;
    return {
        blob: blob,
        width: outW,
        height: outH,
        sourceSize: sourceSize,
        processedSize: processedSize,
        compressed: compressed,
        quality: isPng ? null : usedQuality,
    };
}

async function processCoverImage(file, options) {
    const opts = options || {};
    const decoded = await decodeCoverImage(file, opts);
    let result;
    try {
        result = await cropAndEncodeCoverImage(Object.assign({}, opts, {
            bitmap: decoded.bitmap,
            sourceWidth: decoded.width,
            sourceHeight: decoded.height,
            sourceSize: (file && file.size) || 0,
        }));
    } finally {
        try { decoded.bitmap && decoded.bitmap.close && decoded.bitmap.close(); } catch (_) {}
    }
    return {
        blob: result.blob,
        width: result.width,
        height: result.height,
        sourceSize: (file && file.size) || 0,
        processedSize: result.processedSize,
        compressed: result.compressed,
        type: (opts && opts.type) || 'image/jpeg',
        ratio: '1:1',
    };
}

async function parseKernelResponse(response) {
    if (!response || !response.ok) throw mediaError('MEDIA_API_FAILED', 'SiYuan file API request failed');
    const payload = await response.json();
    if (!payload || payload.code !== 0) {
        throw mediaError('MEDIA_API_FAILED', (payload && payload.msg) || 'SiYuan file API request failed');
    }
    return payload;
}

function getFetch(options) {
    const fetchFn = options && options.fetch;
    if (typeof fetchFn === 'function') return fetchFn;
    if (typeof fetch === 'function') return fetch;
    throw mediaError('MEDIA_FETCH_UNAVAILABLE', 'Fetch is unavailable');
}

/**
 * One-shot move of the legacy assets/ media root to data/public/ via kernel
 * renameFile (supports whole-directory moves and creates the target parent
 * directory). Idempotent: a missing source directory counts as migrated
 * (fresh install or a previous run already moved it). Any other outcome
 * leaves the flag false so the next onload retries. Never throws.
 */
async function migrateLegacyMediaRoot(options) {
    let response;
    try {
        response = await getFetch(options)('/api/file/renameFile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: WORKSPACE_DATA_ROOT + LEGACY_MEDIA_ROOT,
                newPath: WORKSPACE_DATA_ROOT + MEDIA_ROOT,
            }),
        });
    } catch (e) {
        legacyMediaMigrated = false;
        return { status: 'failed', code: 'NETWORK', message: (e && e.message) || 'Network error during media migration' };
    }
    let payload = null;
    try {
        payload = response && typeof response.json === 'function' ? await response.json() : null;
    } catch (e) {
        payload = null;
    }
    const code = payload && typeof payload.code === 'number' ? payload.code : ((response && response.status) || -1);
    if (code === 0) {
        legacyMediaMigrated = true;
        return { status: 'migrated' };
    }
    if (code === 404 || (response && response.status === 404)) {
        legacyMediaMigrated = true;
        return { status: 'absent' };
    }
    legacyMediaMigrated = false;
    return {
        status: 'failed',
        code: code,
        message: (payload && payload.msg) || ('Media migration failed with HTTP ' + ((response && response.status) || 0)),
    };
}

async function uploadImage(assetId, file, options) {
    const validated = validateImageFile(file);
    const opts = options || {};
    const assetPath = createMediaPath(assetId, validated.extension, opts.uuid || createUploadId());
    const FormDataCtor = opts.FormData || (typeof FormData !== 'undefined' ? FormData : null);
    if (!FormDataCtor) throw mediaError('MEDIA_FORM_DATA_UNAVAILABLE', 'FormData is unavailable');
    const body = new FormDataCtor();
    body.append('path', toWorkspaceFilePath(assetPath));
    body.append('file', file, file.name || ('cover.' + validated.extension));
    await parseKernelResponse(await getFetch(opts)('/api/file/putFile', { method: 'POST', body: body }));
    return { kind: COVER_KINDS.UPLOAD, assetPath: assetPath };
}

async function removeUploadCover(cover, assetId, options) {
    const normalized = normalizeCover(cover);
    if (!isOwnedUploadCover(normalized, assetId)) return false;
    const response = await getFetch(options)('/api/file/removeFile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: toWorkspaceFilePath(normalized.assetPath) }),
    });
    await parseKernelResponse(response);
    return true;
}

async function renameUploadCover(cover, assetId, newAssetPath, options) {
    const normalized = normalizeCover(cover);
    const targetPath = String(newAssetPath || '').trim();
    if (!isOwnedUploadCover(normalized, assetId) || !isOwnedMediaPath(targetPath, assetId)) {
        throw mediaError('MEDIA_PATH_INVALID', 'Invalid owned upload cover path');
    }
    const response = await getFetch(options)('/api/file/renameFile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            path: toWorkspaceFilePath(normalized.assetPath),
            newPath: toWorkspaceFilePath(targetPath),
        }),
    });
    await parseKernelResponse(response);
    return { kind: COVER_KINDS.UPLOAD, assetPath: targetPath };
}

async function copyUploadCoverToOwner(cover, sourceAssetId, targetAssetId, options) {
    const normalized = normalizeCover(cover);
    if (!isOwnedUploadCover(normalized, sourceAssetId)) {
        throw mediaError('MEDIA_PATH_INVALID', 'Invalid source upload cover path');
    }
    const filename = normalized.assetPath.split('/').pop();
    const targetPath = MEDIA_ROOT + '/' + String(targetAssetId || '').trim() + '/' + filename;
    if (!isOwnedMediaPath(targetPath, targetAssetId)) {
        throw mediaError('MEDIA_PATH_INVALID', 'Invalid target upload cover path');
    }
    const opts = options || {};
    const fetchFn = getFetch(opts);
    const sourceResponse = await fetchFn('/api/file/getFile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: toWorkspaceFilePath(normalized.assetPath) }),
    });
    if (!sourceResponse || !sourceResponse.ok || typeof sourceResponse.blob !== 'function') {
        throw mediaError('MEDIA_API_FAILED', 'Failed to read source upload cover');
    }
    const blob = await sourceResponse.blob();
    const FormDataCtor = opts.FormData || (typeof FormData !== 'undefined' ? FormData : null);
    if (!FormDataCtor) throw mediaError('MEDIA_FORM_DATA_UNAVAILABLE', 'FormData is unavailable');
    const body = new FormDataCtor();
    body.append('path', toWorkspaceFilePath(targetPath));
    body.append('file', blob, filename);
    await parseKernelResponse(await fetchFn('/api/file/putFile', { method: 'POST', body: body }));
    return { kind: COVER_KINDS.UPLOAD, assetPath: targetPath };
}

async function cleanupReplacedCover(previousCover, nextCover, assetId, options) {
    const previous = normalizeCover(previousCover);
    const next = normalizeCover(nextCover);
    if (!isUploadCover(previous) || previous.assetPath === (next && next.assetPath)) return false;
    return removeUploadCover(previous, assetId, options);
}

async function cleanupDeletedCover(cover, assetId, options) {
    const normalized = normalizeCover(cover);
    // Deletion must never turn a persisted URL, preset, or arbitrary workspace
    // upload into a file mutation. Only this asset's generated upload path qualifies.
    if (!isOwnedUploadCover(normalized, assetId)) return false;
    return removeUploadCover(normalized, assetId, options);
}

module.exports = {
    MEDIA_ROOT: MEDIA_ROOT,
    LEGACY_MEDIA_ROOT: LEGACY_MEDIA_ROOT,
    WORKSPACE_DATA_ROOT: WORKSPACE_DATA_ROOT,
    PRESET_ICON_ROOT: PRESET_ICON_ROOT,
    DEFAULT_PRESET_ICON_ID: DEFAULT_PRESET_ICON_ID,
    MAX_UPLOAD_BYTES: MAX_UPLOAD_BYTES,
    COVER_MAX_DIMENSION: COVER_MAX_DIMENSION,
    COVER_QUALITY: COVER_QUALITY,
    COVER_COMPRESSED_THRESHOLD: COVER_COMPRESSED_THRESHOLD,
    COVER_QUALITY_LADDER: COVER_QUALITY_LADDER,
    COVER_DEFAULT_OUTPUT_SIZE: COVER_DEFAULT_OUTPUT_SIZE,
    decodeCoverImage: decodeCoverImage,
    cropAndEncodeCoverImage: cropAndEncodeCoverImage,
    processCoverImage: processCoverImage,
    ALLOWED_IMAGE_TYPES: ALLOWED_IMAGE_TYPES,
    COVER_KINDS: COVER_KINDS,
    normalizeWorkspaceAssetPath: normalizeWorkspaceAssetPath,
    toWorkspaceFilePath: toWorkspaceFilePath,
    isLegacyMediaMigrated: isLegacyMediaMigrated,
    resolvePhysicalAssetPath: resolvePhysicalAssetPath,
    migrateLegacyMediaRoot: migrateLegacyMediaRoot,
    isLegacyIconParkPreset: isLegacyIconParkPreset,
    normalizeCover: normalizeCover,
    isUploadCover: isUploadCover,
    isWorkspaceAssetCover: isWorkspaceAssetCover,
    isOwnedMediaPath: isOwnedMediaPath,
    isOwnedUploadCover: isOwnedUploadCover,
    resolveCoverUrl: resolveCoverUrl,
    createMediaPath: createMediaPath,
    createUploadSession: createUploadSession,
    cancelUploadSession: cancelUploadSession,
    isUploadSessionActive: isUploadSessionActive,
    validateImageFile: validateImageFile,
    uploadImage: uploadImage,
    removeUploadCover: removeUploadCover,
    renameUploadCover: renameUploadCover,
    copyUploadCoverToOwner: copyUploadCoverToOwner,
    cleanupReplacedCover: cleanupReplacedCover,
    cleanupDeletedCover: cleanupDeletedCover,
};

},
"api/report.js": function(module, exports, __require, externalRequire) {
/* eslint-disable no-use-before-define */
'use strict';

/**
 * 可信报表聚合层。
 *
 * 输入仅为内存快照，输出为可 JSON 序列化的冻结值；金额始终按 currency
 * 分组，绝不进行跨币种换算或合计。这里的 `byCurrency` 是 JSON 兼容的
 * currency map，而不是 JavaScript Map。
 */

const {
    FORMAL_ASSET_KINDS,
    FORMAL_ASSET_KIND,
    validateFormalV2Asset,
    validateSubscriptionPeriodRecord,
    validateSubscriptionPeriodsNoOverlap,
    validateFinancialRecord,
    validateFinancialReplacementChain,
    validateFormalPrepaidTransaction,
    validateFormalLifecycleRecord,
    validateFormalLifecycleReplacementChain,
    projectFormalAsset,
    formalDailyAmountMinor,
    LIFECYCLE_EVENT_TYPE,
    ASSET_STATUS,
    FINANCIAL_EVENT_TYPE,
    FINANCIAL_DIRECTION,
} = __require("api/assets.js");
const { isUUID, daysUntil } = __require("api/algorithms.js");

const DEFAULT_MONTHS = 12;
const MAX_MONTHS = 120;
// v2.6.4 订阅月度支出折算：有当期周期时按周期实际天数摊到月度（≈ 日均 ×
// 30.4375，与订阅日均口径一致）；此处名义月数仅在周期起止不可用时作回落
// （非法/缺失 cycle 回落 1）。
const SUBSCRIPTION_BILLING_CYCLE_MONTHS = Object.freeze({ monthly: 1, quarterly: 3, halfYearly: 6, yearly: 12 });
function finite(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : (fallback || 0); }
function currencyOf(value) { return String(value || 'CNY').trim().toUpperCase() || 'CNY'; }
function createDict() { return Object.create(null); }
function hasOwn(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
function normalizeList(value) { return Array.isArray(value) ? Array.from(new Set(value.map(item => String(item).trim()).filter(Boolean))) : []; }
function dayKey(date) { return date.toISOString().slice(0, 10); }
function monthKey(date) { return date.toISOString().slice(0, 7); }
function parseRecordedDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getTime());
    if (typeof value !== 'string' || !value.trim()) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const date = new Date(value + 'T00:00:00.000Z');
        return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}
function beijingBusinessDateFromInstant(value) {
    const date = parseRecordedDate(value);
    return date ? new Date(date.getTime() + 8 * 3600000) : null;
}
function getMonthWindow(filter) {
    const end = parseRecordedDate(filter.endDate);
    const start = filter.dateFrom ? parseRecordedDate(filter.dateFrom) : new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - filter.months + 1, 1));
    const buckets = [];
    let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    while (cursor <= end) {
        const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
        buckets.push({ key: monthKey(cursor), startDate: dayKey(cursor), endDate: dayKey(new Date(Math.min(end.getTime(), next.getTime() - 86400000))) });
        cursor = next;
    }
    return { rangeStart: start, rangeEnd: end, buckets: buckets };
}
function isWithinReportRange(date, window) { return !!date && date >= window.rangeStart && date <= window.rangeEnd; }

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(key => deepFreeze(value[key]));
    return Object.freeze(value);
}

// ---------------------------------------------------------------------------
// Formal-v1 report/dashboard entry points.
// ---------------------------------------------------------------------------

function formalReportError(message, cause, path) {
    const error = new TypeError('[formal-report] ' + message);
    error.code = 'FORMAL_REPORT_INVALID';
    if (path) error.path = path;
    if (cause) error.cause = cause;
    return error;
}

function normalizeFormalReportFilter(input, now) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const unknown = Object.keys(source).filter(key => [
        'months', 'dateFrom', 'endDate', 'statuses', 'status', 'kinds', 'kind',
        'tagIds', 'categoryIds', 'categoryId', 'currencies', 'currency',
    ].indexOf(key) < 0);
    if (unknown.length) throw formalReportError('filter contains unknown field: ' + unknown[0]);
    if (hasOwn(source, 'dateFrom') && !isBusinessDateString(source.dateFrom)) throw formalReportError('dateFrom must be YYYY-MM-DD');
    if (hasOwn(source, 'endDate') && !isBusinessDateString(source.endDate)) throw formalReportError('endDate must be YYYY-MM-DD');
    const reference = hasOwn(source, 'endDate') ? source.endDate : dayKey(beijingBusinessDateFromInstant(now) || beijingBusinessDateFromInstant(new Date()));
    const months = Math.max(1, Math.min(MAX_MONTHS, Math.floor(finite(source.months, DEFAULT_MONTHS)) || DEFAULT_MONTHS));
    const dateFrom = hasOwn(source, 'dateFrom') ? source.dateFrom : null;
    if (dateFrom && dateFrom > reference) throw formalReportError('dateFrom must not be after endDate');
    const kinds = normalizeList(source.kinds || (source.kind ? [source.kind] : []));
    if (kinds.some(kind => FORMAL_ASSET_KINDS.indexOf(kind) < 0)) throw formalReportError('filter kind is invalid');
    const statuses = normalizeList(source.statuses || (source.status && source.status !== 'all' ? [source.status] : []));
    if (statuses.some(status => status !== 'active' && status !== 'retired')) throw formalReportError('filter status is invalid');
    const tagIds = normalizeList(source.tagIds);
    const categoryIds = normalizeList(source.categoryIds || (source.categoryId ? [source.categoryId] : []));
    const currencies = normalizeList(source.currencies || (source.currency && source.currency !== 'all' ? [source.currency] : [])).map(currencyOf);
    return {
        months: months,
        dateFrom: dateFrom,
        endDate: reference,
        statuses: statuses,
        kinds: kinds,
        tagIds: tagIds,
        categoryIds: categoryIds,
        currencies: currencies,
        timeBasis: 'acquiredOn',
    };
}

function isBusinessDateString(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !!parseRecordedDate(value);
}

function formalSnapshotArray(source, key, recordKey, required) {
    const value = source[key];
    if (value == null) {
        if (required) throw formalReportError(key + ' is required for a complete formal snapshot');
        return [];
    }
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value[recordKey])) return value[recordKey];
    throw formalReportError(key + ' must be an array or wrapper');
}

function formalSnapshotForProjection(source) {
    return {
        subscriptionPeriods: formalSnapshotArray(source, "subscriptionPeriods", "records", false),
        prepaidTransactions: formalSnapshotArray(source, "prepaidTransactions", "records", false),
        financialEvents: formalSnapshotArray(source, "financialEvents", "events", false),
        maintenance: formalSnapshotArray(source, "maintenance", "records", false),
        lifecycleEvents: formalSnapshotArray(source, "lifecycleEvents", "events", false),
        wishlistEvents: formalSnapshotArray(source, "wishlistEvents", "events", false),
    };
}

function safeAddFormal(left, right, label) {
    if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) throw formalReportError(label + ' must be safe integers');
    const result = left + right;
    if (!Number.isSafeInteger(result)) throw formalReportError(label + ' exceeds safe integer range');
    return result;
}

function incrementFormalGroup(groups, key, label) {
    const group = String(key || 'unspecified');
    groups[group] = safeAddFormal(hasOwn(groups, group) ? groups[group] : 0, 1, label || 'count');
}

function validateFormalReportSidecars(assets, sidecars) {
    const index = createDict();
    const globalIds = new Set();
    assets.forEach(asset => {
        if (globalIds.has(asset.id)) throw formalReportError('duplicate global id: ' + asset.id);
        globalIds.add(asset.id);
        if (asset.status !== 'wishlist') index[asset.id] = asset;
    });
    const assertOwner = (record, path) => {
        if (!record || typeof record.assetId !== 'string' || !hasOwn(index, record.assetId)) throw formalReportError(path + '.assetId references no owned asset');
        return index[record.assetId];
    };
    const assertRecordUuid = (record, path) => {
        if (!record || !isUUID(record.id) || record.id !== record.id.toLowerCase()) {
            throw formalReportError(path + '.id must be a lowercase UUID');
        }
        if (globalIds.has(record.id)) throw formalReportError(path + '.id duplicates global id ' + record.id);
        globalIds.add(record.id);
        if (!isUUID(record.assetId) || record.assetId !== record.assetId.toLowerCase()) {
            throw formalReportError(path + '.assetId must be a lowercase UUID');
        }
    };
    const periodValidation = validateSubscriptionPeriodsNoOverlap(sidecars.subscriptionPeriods);
    if (!periodValidation.valid) throw formalReportError('subscriptionPeriods are invalid: ' + periodValidation.errors.join('; '));
    sidecars.subscriptionPeriods.forEach((record, recordIndex) => {
        assertRecordUuid(record, 'subscriptionPeriods[' + recordIndex + ']');
        const validation = validateSubscriptionPeriodRecord(record);
        if (!validation.valid) throw formalReportError('subscriptionPeriods[' + recordIndex + '] is invalid: ' + validation.errors.join('; '));
        const owner = assertOwner(record, 'subscriptionPeriods[' + recordIndex + ']');
        if (owner.kind !== FORMAL_ASSET_KIND.VIRTUAL_SUBSCRIPTION) throw formalReportError('subscriptionPeriods[' + recordIndex + '] belongs to an incompatible asset kind');
    });
    sidecars.prepaidTransactions.forEach((record, recordIndex) => {
        assertRecordUuid(record, 'prepaidTransactions[' + recordIndex + ']');
        const owner = assertOwner(record, 'prepaidTransactions[' + recordIndex + ']');
        if (owner.kind !== FORMAL_ASSET_KIND.PREPAID_AMOUNT && owner.kind !== FORMAL_ASSET_KIND.PREPAID_COUNT) throw formalReportError('prepaidTransactions[' + recordIndex + '] belongs to an incompatible asset kind');
        const validation = { valid: true, errors: [] };
        if (!validation.valid) throw formalReportError('prepaidTransactions[' + recordIndex + '] is invalid: ' + validation.errors.join('; '));
    });
    sidecars.financialEvents.forEach((record, recordIndex) => {
        assertRecordUuid(record, 'financialEvents[' + recordIndex + ']');
        const validation = validateFinancialRecord(record);
        if (!validation.valid) throw formalReportError('financialEvents[' + recordIndex + '] is invalid: ' + validation.errors.join('; '));
        const owner = assertOwner(record, 'financialEvents[' + recordIndex + ']');
        if (record.currency !== owner.currency) {
            throw formalReportError('financialEvents[' + recordIndex + '].currency is ' + record.currency + '; expected owner currency ' + owner.currency);
        }
        if (record.eventType === 'subscriptionPayment' && owner.kind !== FORMAL_ASSET_KIND.VIRTUAL_SUBSCRIPTION) throw formalReportError('financialEvents[' + recordIndex + '] belongs to an incompatible asset kind');
        if ((record.eventType === 'prepaidCharge' || record.eventType === 'prepaidConsumption')
            && owner.kind !== FORMAL_ASSET_KIND.PREPAID_AMOUNT && owner.kind !== FORMAL_ASSET_KIND.PREPAID_COUNT) throw formalReportError('financialEvents[' + recordIndex + '] belongs to an incompatible asset kind');
        if (record.eventType === 'maintenance' && owner.kind !== FORMAL_ASSET_KIND.PHYSICAL) throw formalReportError('financialEvents[' + recordIndex + '] belongs to an incompatible asset kind');
        if (record.eventType === 'purchase' && owner.kind === FORMAL_ASSET_KIND.VIRTUAL_SUBSCRIPTION) throw formalReportError('financialEvents[' + recordIndex + '] subscriptions use subscriptionPayment events');
    });
    const replacementValidation = validateFinancialReplacementChain(sidecars.financialEvents);
    if (!replacementValidation.valid) throw formalReportError('financialEvents replacement chain is invalid: ' + replacementValidation.errors.join('; '));
    const financialById = new Map(sidecars.financialEvents.map(event => [event.id, event]));
    const prepaidFinancialLinks = new Map();
    sidecars.prepaidTransactions.forEach((record, recordIndex) => {
        if (record.dimension === 'count' && record.financialEventId == null) return;
        if (prepaidFinancialLinks.has(record.financialEventId)) {
            throw formalReportError('prepaidTransactions[' + recordIndex + '].financialEventId is already linked by prepaidTransactions['
                + prepaidFinancialLinks.get(record.financialEventId) + ']');
        }
        prepaidFinancialLinks.set(record.financialEventId, recordIndex);
        const event = financialById.get(record.financialEventId);
        const expectedTypes = record.type === 'opening' ? ['purchase', 'adjustment']
            : (record.type === 'inflow' ? ['prepaidCharge']
                : (record.type === 'outflow' ? ['prepaidConsumption']
                    : (record.type === 'refund' ? ['refund'] : ['adjustment'])));
        const expectedDirection = record.type === 'refund' ? 'inflow'
            : (record.type === 'inflow' || (event && event.eventType === 'purchase') ? 'outflow' : record.direction);
        const mustBeNonCash = record.type === 'outflow' || record.type === 'adjust'
            || (event && event.eventType === 'adjustment');
        if (!event || event.assetId !== record.assetId || event.currency !== index[record.assetId].currency
            || expectedTypes.indexOf(event.eventType) < 0 || event.direction !== expectedDirection || event.voidedAt
            || event.effectiveDate !== record.effectiveDate
            || (mustBeNonCash && event.metadata.affectsCash !== false)) {
            throw formalReportError('prepaidTransactions[' + recordIndex + '].financialEventId has incompatible semantics');
        }
    });
    sidecars.subscriptionPeriods.forEach((record, recordIndex) => {
        if (record.paymentEventId == null) return;
        const event = financialById.get(record.paymentEventId);
        if (!event || event.assetId !== record.assetId
            || event.eventType !== 'subscriptionPayment' || event.direction !== 'outflow'
            || event.currency !== index[record.assetId].currency || event.voidedAt) {
            throw formalReportError('subscriptionPeriods[' + recordIndex + '].paymentEventId has incompatible semantics');
        }
    });
    sidecars.maintenance.forEach((record, recordIndex) => {
        const path = 'maintenance[' + recordIndex + ']';
        assertRecordUuid(record, path);
        const owner = assertOwner(record, path);
        if (owner.kind !== FORMAL_ASSET_KIND.PHYSICAL) throw formalReportError(path + ' belongs to an incompatible asset kind');
        const keys = Object.keys(record || {});
        const unknown = keys.filter(key => ['id', 'assetId', 'type', 'date', 'note', 'createdAt', 'financialEventId', 'details'].indexOf(key) < 0);
        if (unknown.length) throw formalReportError(path + ' contains unknown field ' + unknown[0]);
        if (record.type !== 'repair' && record.type !== 'maintain') throw formalReportError(path + '.type is invalid');
        if (record.financialEventId !== null && !isUUID(record.financialEventId)) throw formalReportError(path + '.financialEventId must be a UUID or null');
        if (!record.details || typeof record.details !== 'object' || Array.isArray(record.details)) throw formalReportError(path + '.details must be an object');
        if (Object.keys(record.details).length) throw formalReportError(path + '.details contains unsupported field ' + Object.keys(record.details)[0]);
        if (!isBusinessDateString(record.date)) throw formalReportError(path + '.date must be YYYY-MM-DD');
        if (typeof record.note !== 'string' || typeof record.createdAt !== 'string'
            || Number.isNaN(Date.parse(record.createdAt)) || new Date(record.createdAt).toISOString() !== record.createdAt) {
            throw formalReportError(path + ' has invalid note or createdAt');
        }
    });
    const lifecycleKinds = Object.values(LIFECYCLE_EVENT_TYPE);
    sidecars.lifecycleEvents.forEach((record, recordIndex) => {
        const path = 'lifecycleEvents[' + recordIndex + ']';
        assertRecordUuid(record, path);
        const owner = assertOwner(record, path);
        const validation = validateFormalLifecycleRecord(record);
        if (!validation.valid) throw formalReportError(path + ' is invalid: ' + validation.errors.join('; '));
        const subscriptionKinds = ['subscriptionStarted', 'subscriptionRenewed', 'subscriptionReopened', 'subscriptionCancelled', 'subscriptionSkipped'];
        if (subscriptionKinds.includes(record.kind) && owner.kind !== FORMAL_ASSET_KIND.VIRTUAL_SUBSCRIPTION) {
            throw formalReportError(path + ' belongs to an incompatible asset kind');
        }
        if (record.kind === 'maintenanceRecorded' && owner.kind !== FORMAL_ASSET_KIND.PHYSICAL) {
            throw formalReportError(path + ' belongs to an incompatible asset kind');
        }
    });
    const lifecycleChain = validateFormalLifecycleReplacementChain(sidecars.lifecycleEvents);
    if (!lifecycleChain.valid) throw formalReportError('lifecycleEvents replacement chain is invalid: ' + lifecycleChain.errors.join('; '));
    return index;
}

function sidecarsForFormalAsset(sidecars, assetId) {
    return {
        subscriptionPeriods: sidecars.subscriptionPeriods.filter(record => record.assetId === assetId),
        prepaidTransactions: sidecars.prepaidTransactions.filter(record => record.assetId === assetId),
        financialEvents: sidecars.financialEvents.filter(record => record.assetId === assetId),
    };
}

function incrementFormalMinorBucket(target, currency, field, amountMinor, countField) {
    if (!hasOwn(target, currency)) target[currency] = { currency: currency };
    target[currency][field] = safeAddFormal(target[currency][field] == null ? 0 : target[currency][field], amountMinor, field);
    if (countField) target[currency][countField] = safeAddFormal(target[currency][countField] == null ? 0 : target[currency][countField], 1, countField);
}

function formalRiskEntry(card, date, reference) {
    if (!date) return null;
    const parsed = parseRecordedDate(date);
    if (!parsed) return null;
    return {
        assetId: card.id,
        date: date,
        daysRemaining: daysUntil(date, dayKey(reference)),
    };
}

function buildFormalReport(snapshot, filterInput, options) {
    const source = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : {};
    const assets = formalSnapshotArray(source, 'assets', 'assets', true);
    assets.forEach((asset, index) => {
        const validation = validateFormalV2Asset(asset);
        if (!validation.valid) throw formalReportError('assets[' + index + '] is not canonical: ' + validation.errors.join('; '));
    });
    const globalAssetIds = new Set();
    assets.forEach((asset, index) => {
        if (globalAssetIds.has(asset.id)) throw formalReportError('assets[' + index + '].id must be globally unique');
        globalAssetIds.add(asset.id);
    });
    const filter = normalizeFormalReportFilter(filterInput, options && options.now);
    const window = getMonthWindow(filter);
    const reference = parseRecordedDate(filter.endDate);
    const sidecars = formalSnapshotForProjection(source);
    validateFormalReportSidecars(assets, sidecars);
    const selected = assets.filter(asset => {
        if (asset.status === 'wishlist') return false;
        if (filter.statuses.length && !filter.statuses.includes(asset.status)) return false;
        if (filter.kinds.length && !filter.kinds.includes(asset.kind)) return false;
        if (filter.currencies.length && !filter.currencies.includes(asset.currency)) return false;
        if (filter.tagIds.length && !filter.tagIds.some(tagId => asset.tagIds.includes(tagId))) return false;
        if (filter.categoryIds.length && !filter.categoryIds.includes(asset.categoryId)) return false;
        const acquired = parseRecordedDate(asset.acquiredOn);
        return acquired && isWithinReportRange(acquired, window);
    });
    const cards = selected.map((asset, index) => {
        const path = 'selectedAssets[' + index + '](' + asset.id + ')';
        try {
            return projectFormalAsset(asset, sidecarsForFormalAsset(sidecars, asset.id), filter.endDate);
        } catch (error) {
            // Only formal contract validation errors cross this public report
            // boundary as FORMAL_REPORT_INVALID. Programming errors retain their
            // original type/stack and are deliberately not swallowed.
            if (error && error.code === 'FORMAL_ASSET_INVALID') {
                throw formalReportError(path + ': ' + error.message, error, path);
            }
            throw error;
        }
    });
    const buckets = window.buckets.map(bucket => ({
        key: bucket.key,
        startDate: bucket.startDate,
        endDate: bucket.endDate,
        assetCount: 0,
        acquisitionAmountMinorByCurrency: createDict(),
    }));
    const bucketByKey = createDict();
    buckets.forEach(bucket => { bucketByKey[bucket.key] = bucket; });
    const report = {
        schemaGeneration: 'formal-v2',
        filter: filter,
        assets: cards,
        counts: { total: cards.length, byKind: createDict(), byStatus: createDict() },
        tags: { uniqueCount: 0, byTagId: createDict() },
        // v2.6.5 阶段3a：品牌 / 途径维度聚合（与 tags.byTagId 同构）。金额聚合不进
        // 报表契约——UI 层折 CNY；未设置 brandId/channelId 的资产不进聚合（UI 单独
        // 归「未设置」桶）。
        brand: { uniqueCount: 0, byId: createDict() },
        channel: { uniqueCount: 0, byId: createDict() },
        amounts: {
            acquisitionByCurrency: createDict(),
            // 口径（v2.6.2）：净额与日均只累计在役（active）资产；退役资产不计入
            // 「我的资产」总金额，其转让所得单独聚合到 retiredSaleByCurrency。
            netByCurrency: createDict(),
            // 退役回收：退役资产的转让卖出（sale + inflow）流入合计，按资产币种分组；
            // assetCount = 至少有一笔 sale 事件的退役资产数（每张卡最多计 1 次）。
            retiredSaleByCurrency: createDict(),
            recordedFinancialsByCurrency: createDict(),
        },
        rankings: { byCurrency: createDict() },
        prepaid: {
            // amountByCurrency：金额维逐币种聚合；v2.6.3 起次数维实付（购买/充值
            // 实付-退款，消费按次数占比摊销）也并入本桶对应币种，保证次数卡有钱可看。
            amountByCurrency: createDict(),
            countByAsset: createDict(),
            // v2.6.3：次数维卡合计；charge = 期初 + 追加，consume = 消费。
            countTotals: { assetCount: 0, remainingCount: 0, chargeCount: 0, consumeCount: 0 },
            expiringWithin30Days: [],
        },
        // v2.6.3 订阅专属聚合（不复用实物口径）：累计支出含已退役订阅的历史
        // 付款；月度支出只在役，并按计费周期折算；试用期（无付款事件）计 0。
        subscription: {
            total: 0,
            byState: { subscribed: 0, expired: 0, pendingConfirmation: 0, trial: 0 },
            byCurrency: createDict(),
            upcomingRenewals: [],
        },
        maintenance: { recordCount: 0, costByCurrency: createDict() },
        wishlist: { total: 0, active: 0, purchased: 0, abandoned: 0, purchaseRate: 0, abandonRate: 0 },
        dataCoverage: {
            maintenance: { provided: sidecars.maintenance.length, selected: 0 },
            lifecycleEvents: { provided: sidecars.lifecycleEvents.length, selected: 0 },
        },
        risks: {
            expiry: { expired: [], within7Days: [], within30Days: [] },
            renewal: { lapsed: [], indeterminate: [], trials: [], plannedWithin30Days: [] },
            costGoal: { achieved: [], pending: [] },
        },
        trends: { timeBasis: 'acquiredOn', buckets: buckets },
    };

    // Wishlist conversion is event-sourced. Keep it separate from owned-asset
    // counts because wishlist assets are intentionally excluded from report.cards.
    const wishlistIds = new Set(assets.filter(asset => asset.status === 'wishlist').map(asset => asset.id));
    const purchasedIds = new Set();
    const abandonedIds = new Set();
    sidecars.wishlistEvents.forEach(event => {
        if (!event || !event.sourceWishlistId) return;
        wishlistIds.add(event.sourceWishlistId);
        if (event.eventType === 'purchased') purchasedIds.add(event.sourceWishlistId);
        if (event.eventType === 'abandoned') abandonedIds.add(event.sourceWishlistId);
    });
    report.wishlist.total = wishlistIds.size;
    report.wishlist.active = assets.filter(asset => asset.status === 'wishlist').length;
    report.wishlist.purchased = purchasedIds.size;
    report.wishlist.abandoned = abandonedIds.size;
    report.wishlist.purchaseRate = wishlistIds.size ? purchasedIds.size / wishlistIds.size : 0;
    report.wishlist.abandonRate = wishlistIds.size ? abandonedIds.size / wishlistIds.size : 0;

    // v2.6.5 阶段3a：投影卡不携带 brandId/channelId（投影契约保持不变），经资产 id
    // 回查原始归一化资产取维度外键。selected 与 cards 由同一次 map 产出，严格同序同长。
    const dimensionRefsByAssetId = createDict();
    selected.forEach(asset => {
        if (asset.brandId == null && asset.channelId == null) return;
        dimensionRefsByAssetId[asset.id] = { brandId: asset.brandId, channelId: asset.channelId };
    });

    cards.forEach(card => {
        incrementFormalGroup(report.counts.byKind, card.kind, 'counts.byKind');
        // v2.6.6：概览「在役 / 退役」按有效状态口径——过期订阅（在役实体 + 投影
        // state === 'expired'）计入 retired，不再计入 active；与首页统计一致。
        const effectiveStatus = (card.status === 'active' && card.subscription && card.subscription.state === 'expired')
            ? 'retired' : card.status;
        incrementFormalGroup(report.counts.byStatus, effectiveStatus, 'counts.byStatus');
        card.tagIds.forEach(tagId => {
            if (!hasOwn(report.tags.byTagId, tagId)) report.tags.byTagId[tagId] = { count: 0, assetIds: [] };
            report.tags.byTagId[tagId].count = safeAddFormal(report.tags.byTagId[tagId].count, 1, 'tags.count');
            report.tags.byTagId[tagId].assetIds.push(card.id);
        });
        // v2.6.5 阶段3a：品牌 / 途径维度计数 + 资产 id 归档（口径与 tags.byTagId 一致）。
        const dimensionRefs = dimensionRefsByAssetId[card.id];
        if (dimensionRefs) {
            ['brandId', 'channelId'].forEach(refKey => {
                const refValue = dimensionRefs[refKey];
                if (refValue == null) return;
                const group = refKey === 'brandId' ? report.brand.byId : report.channel.byId;
                if (!hasOwn(group, refValue)) group[refValue] = { count: 0, assetIds: [] };
                group[refValue].count = safeAddFormal(group[refValue].count, 1, refKey + '.count');
                group[refValue].assetIds.push(card.id);
            });
        }
        incrementFormalMinorBucket(report.amounts.acquisitionByCurrency, card.currency, 'amountMinor', card.acquisition.amountMinor, 'assetCount');
        // 口径（v2.6.2）：净额/日均只在役——退役资产不参与总金额与日均聚合。
        if (card.status === ASSET_STATUS.ACTIVE) {
            if (!hasOwn(report.amounts.netByCurrency, card.currency)) report.amounts.netByCurrency[card.currency] = {
                currency: card.currency, netAmountMinor: 0, dailyAmountMinor: 0, assetCount: 0,
            };
            const netBucket = report.amounts.netByCurrency[card.currency];
            netBucket.netAmountMinor = safeAddFormal(netBucket.netAmountMinor, card.financials.cashTotals.netAmountMinor, 'netByCurrency.netAmountMinor');
            const daily = formalDailyAmountMinor({
                kind: card.kind,
                acquiredOn: card.acquiredOn,
                cashNetAmountMinor: card.financials.cashTotals.netAmountMinor,
                referenceDate: reference,
                subscription: card.subscription,
                financialEvents: sidecars.financialEvents.filter(event => event && event.assetId === card.id),
            });
            netBucket.dailyAmountMinor = safeAddFormal(netBucket.dailyAmountMinor, daily.amountMinor, 'netByCurrency.dailyAmountMinor');
            netBucket.assetCount = safeAddFormal(netBucket.assetCount, 1, 'netByCurrency.assetCount');
        }
        // 退役回收：退役资产的转让卖出流入合计（按资产币种）；每张卡最多计 1 次 assetCount。
        if (card.status === ASSET_STATUS.RETIRED) {
            const saleEvents = sidecars.financialEvents.filter(event => event
                && event.assetId === card.id
                && !event.voidedAt
                && event.eventType === FINANCIAL_EVENT_TYPE.SALE
                && event.direction === FINANCIAL_DIRECTION.INFLOW);
            if (saleEvents.length) {
                if (!hasOwn(report.amounts.retiredSaleByCurrency, card.currency)) {
                    report.amounts.retiredSaleByCurrency[card.currency] = {
                        currency: card.currency, saleAmountMinor: 0, assetCount: 0,
                    };
                }
                const saleBucket = report.amounts.retiredSaleByCurrency[card.currency];
                saleEvents.forEach(event => {
                    saleBucket.saleAmountMinor = safeAddFormal(saleBucket.saleAmountMinor, event.amountMinor, 'retiredSaleByCurrency.saleAmountMinor');
                });
                saleBucket.assetCount = safeAddFormal(saleBucket.assetCount, 1, 'retiredSaleByCurrency.assetCount');
            }
        }
        if (!hasOwn(report.rankings.byCurrency, card.currency)) report.rankings.byCurrency[card.currency] = [];
        report.rankings.byCurrency[card.currency].push({ assetId: card.id, name: card.name,
            acquisitionAmountMinor: card.financials.acquisitionAmountMinor, netAmountMinor: card.financials.cashTotals.netAmountMinor });
        const recorded = card.financials.cashTotals;
        if (!hasOwn(report.amounts.recordedFinancialsByCurrency, card.currency)) {
            report.amounts.recordedFinancialsByCurrency[card.currency] = {
                currency: card.currency, inflowAmountMinor: 0, outflowAmountMinor: 0, netAmountMinor: 0, eventCount: 0,
            };
        }
        const financeBucket = report.amounts.recordedFinancialsByCurrency[card.currency];
        ['inflowAmountMinor', 'outflowAmountMinor', 'netAmountMinor', 'eventCount'].forEach(field => {
            financeBucket[field] = safeAddFormal(financeBucket[field], recorded[field], 'recordedFinancials.' + field);
        });

        if (card.prepaid && card.prepaid.dimension === 'amount') {
            if (!hasOwn(report.prepaid.amountByCurrency, card.currency)) {
                report.prepaid.amountByCurrency[card.currency] = { currency: card.currency, balanceAmountMinor: 0, assetCount: 0, transactionCount: 0, chargeAmountMinor: 0, consumeAmountMinor: 0 };
            }
            const target = report.prepaid.amountByCurrency[card.currency];
            target.balanceAmountMinor = safeAddFormal(target.balanceAmountMinor, card.prepaid.balanceAmountMinor, 'prepaid.balanceAmountMinor');
            target.assetCount = safeAddFormal(target.assetCount, 1, 'prepaid.assetCount');
            target.transactionCount = safeAddFormal(target.transactionCount, card.prepaid.transactionCount, 'prepaid.transactionCount');
            // v2.6.3：charge = 期初 + 追加充值，consume = 消费；utilizationRate 循环后统一投影。
            target.chargeAmountMinor = safeAddFormal(target.chargeAmountMinor,
                safeAddFormal(card.prepaid.openingAmountMinor, card.prepaid.inflowAmountMinor, 'prepaid.chargeAmountMinor'), 'prepaid.chargeAmountMinor');
            target.consumeAmountMinor = safeAddFormal(target.consumeAmountMinor, card.prepaid.outflowAmountMinor, 'prepaid.consumeAmountMinor');
        } else if (card.prepaid) {
            const key = card.id;
            if (!hasOwn(report.prepaid.countByAsset, key)) {
                report.prepaid.countByAsset[key] = { assetId: key, remainingCount: 0, assetCount: 0, transactionCount: 0 };
            }
            const target = report.prepaid.countByAsset[key];
            target.remainingCount = safeAddFormal(target.remainingCount, card.prepaid.remainingCount, 'prepaid.remainingCount');
            target.assetCount = safeAddFormal(target.assetCount, 1, 'prepaid.assetCount');
            target.transactionCount = safeAddFormal(target.transactionCount, card.prepaid.transactionCount, 'prepaid.transactionCount');
            // v2.6.3：次数维卡合计；charge = 期初 + 追加，consume = 消费。
            report.prepaid.countTotals.assetCount = safeAddFormal(report.prepaid.countTotals.assetCount, 1, 'prepaid.countTotals.assetCount');
            report.prepaid.countTotals.remainingCount = safeAddFormal(report.prepaid.countTotals.remainingCount, card.prepaid.remainingCount, 'prepaid.countTotals.remainingCount');
            report.prepaid.countTotals.chargeCount = safeAddFormal(report.prepaid.countTotals.chargeCount,
                safeAddFormal(card.prepaid.openingCount, card.prepaid.inflowCount, 'prepaid.countTotals.chargeCount'), 'prepaid.countTotals.chargeCount');
            report.prepaid.countTotals.consumeCount = safeAddFormal(report.prepaid.countTotals.consumeCount, card.prepaid.outflowCount, 'prepaid.countTotals.consumeCount');
            // v2.6.3 次数维实付金额：次数卡的购买价与充值实付同样是钱，必须进预付
            // 分析。实付 = 该卡 prepaidTransactions 关联财务事件中的现金流出合计
            //（PURCHASE / PREPAID_CHARGE）减退款流入；非现金事件（affectsCash=false）
            // 不计。消费按「实付 × 已用次数 ÷ 总授予次数」摊销，余额 = 实付 - 摊销
            // 消费，与次数口径自洽。只并金额三兄弟字段，不动 assetCount/transactionCount。
            const countLinkedEventIds = new Set(sidecars.prepaidTransactions
                .filter(record => record && record.assetId === card.id && record.financialEventId != null)
                .map(record => record.financialEventId));
            let countCashMinor = 0;
            if (countLinkedEventIds.size) {
                sidecars.financialEvents.forEach(event => {
                    if (!event || event.assetId !== card.id || event.voidedAt || !countLinkedEventIds.has(event.id)) return;
                    if (event.metadata && event.metadata.affectsCash === false) return;
                    if (event.direction === FINANCIAL_DIRECTION.OUTFLOW) countCashMinor = safeAddFormal(countCashMinor, event.amountMinor, 'prepaid.countCashOutflow');
                    else if (event.direction === FINANCIAL_DIRECTION.INFLOW) countCashMinor = safeAddFormal(countCashMinor, -event.amountMinor, 'prepaid.countCashRefund');
                });
            }
            if (countCashMinor > 0) {
                if (!hasOwn(report.prepaid.amountByCurrency, card.currency)) {
                    report.prepaid.amountByCurrency[card.currency] = { currency: card.currency, balanceAmountMinor: 0, assetCount: 0, transactionCount: 0, chargeAmountMinor: 0, consumeAmountMinor: 0 };
                }
                const countMoneyBucket = report.prepaid.amountByCurrency[card.currency];
                const countGranted = safeAddFormal(
                    safeAddFormal(card.prepaid.openingCount, card.prepaid.inflowCount, 'prepaid.countGranted'),
                    Math.max(0, Number(card.prepaid.adjustCount) || 0), 'prepaid.countGranted');
                const countUsed = Math.min(Math.max(0, Number(card.prepaid.outflowCount) || 0), countGranted);
                const countConsumedMinor = countGranted > 0 ? Math.round(countCashMinor * countUsed / countGranted) : 0;
                countMoneyBucket.chargeAmountMinor = safeAddFormal(countMoneyBucket.chargeAmountMinor, countCashMinor, 'prepaid.chargeAmountMinor');
                countMoneyBucket.consumeAmountMinor = safeAddFormal(countMoneyBucket.consumeAmountMinor, countConsumedMinor, 'prepaid.consumeAmountMinor');
                countMoneyBucket.balanceAmountMinor = safeAddFormal(countMoneyBucket.balanceAmountMinor, countCashMinor - countConsumedMinor, 'prepaid.balanceAmountMinor');
            }
        }

        // v2.6.7 实验：已提前续订（订阅存在 startDate 晚于今天的未来周期）不再进到期风险列表——
        // 当期虽未结束，但下期已订，首页到期提醒 / 报表「即将到期」不应重复催续。
        const renewedAhead = !!(card.subscription && card.subscription.latestPeriod
            && String(card.subscription.latestPeriod.startDate) > dayKey(reference));
        const expiry = renewedAhead ? null : formalRiskEntry(card, card.nextImportant && card.nextImportant.date, reference);
        if (expiry) {
            if (expiry.daysRemaining < 0) report.risks.expiry.expired.push(expiry);
            else if (expiry.daysRemaining <= 30) {
                report.risks.expiry.within30Days.push(expiry);
                if (expiry.daysRemaining <= 7) report.risks.expiry.within7Days.push(expiry);
            }
        }
        if (card.subscription) {
            if (card.subscription.state === 'lapsed') report.risks.renewal.lapsed.push(card.id);
            if (card.subscription.indeterminate) report.risks.renewal.indeterminate.push(card.id);
            if (card.subscription.isTrial) report.risks.renewal.trials.push(card.id);
            const renewal = formalRiskEntry(card, card.subscription.plannedRenewalDate, reference);
            if (renewal && renewal.daysRemaining >= 0 && renewal.daysRemaining <= 30) report.risks.renewal.plannedWithin30Days.push(renewal);
        }
        if (card.costGoal) report.risks.costGoal[card.costGoal.achieved ? 'achieved' : 'pending'].push(card.id);
        const bucket = bucketByKey[card.acquiredOn.slice(0, 7)];
        bucket.assetCount = safeAddFormal(bucket.assetCount, 1, 'trend.assetCount');
        incrementFormalMinorBucket(bucket.acquisitionAmountMinorByCurrency, card.currency, 'amountMinor', card.acquisition.amountMinor, 'assetCount');
    });

    // -----------------------------------------------------------------
    // v2.6.3 订阅专属聚合：不再套用实物报表口径。累计支出含已退役订阅的
    // 历史付款；月度支出只算在役订阅，按当期周期实际天数折算（v2.6.4）；
    // 试用期计 0。
    // -----------------------------------------------------------------
    const financialEventById = new Map(sidecars.financialEvents.map(event => [event.id, event]));
    const periodPaymentAmountMinor = period => {
        if (!period || period.paymentEventId == null) return 0;
        const paymentEvent = financialEventById.get(period.paymentEventId);
        if (!paymentEvent || paymentEvent.voidedAt) return 0;
        return paymentEvent.amountMinor;
    };
    const billingCycleMonths = asset => {
        const cycle = asset && asset.details && asset.details.billingPlan ? asset.details.billingPlan.cycle : null;
        return typeof cycle === 'string' && hasOwn(SUBSCRIPTION_BILLING_CYCLE_MONTHS, cycle) ? SUBSCRIPTION_BILLING_CYCLE_MONTHS[cycle] : 1;
    };
    // selected 与 cards 同序：取原始资产以获得 cards 投影不含的 details。
    const subscriptionEntries = [];
    cards.forEach((card, index) => {
        if (card.kind === FORMAL_ASSET_KIND.VIRTUAL_SUBSCRIPTION) subscriptionEntries.push({ card: card, asset: selected[index] });
    });
    report.subscription.total = subscriptionEntries.length;
    const subscriptionEntryById = createDict();
    subscriptionEntries.forEach(entry => { subscriptionEntryById[entry.card.id] = entry; });
    subscriptionEntries.forEach(entry => {
        const card = entry.card;
        if (card.status !== ASSET_STATUS.ACTIVE || !card.subscription) return;
        if (!hasOwn(report.subscription.byCurrency, card.currency)) {
            report.subscription.byCurrency[card.currency] = { currency: card.currency, paidAmountMinor: 0, monthlyAmountMinor: 0, activeCount: 0 };
        }
        const currencyBucket = report.subscription.byCurrency[card.currency];
        currencyBucket.activeCount = safeAddFormal(currencyBucket.activeCount, 1, 'subscription.activeCount');
        // 分桶优先级 trial > subscribed > expired > pendingConfirmation，每张卡只计一桶。
        const stateKey = card.subscription.isTrial ? 'trial'
            : (hasOwn(report.subscription.byState, card.subscription.state) ? card.subscription.state : null);
        if (stateKey) report.subscription.byState[stateKey] = safeAddFormal(report.subscription.byState[stateKey], 1, 'subscription.byState.' + stateKey);
        // v2.6.4 月度支出 = 当期付款 ÷ 当期周期实际天数（含两端）× 30.4375，
        // 与订阅日均（formalDailyAmountMinor 的 period 口径）完全自洽；
        // 试用期/无当期/无付款事件计 0；周期起止解析失败或倒挂（periodDays ≤ 0）
        // 时回落名义计费周期月数折算。
        const periodAmount = periodPaymentAmountMinor(card.subscription.currentPeriod);
        if (periodAmount > 0) {
            const period = card.subscription.currentPeriod;
            const periodStart = parseRecordedDate(period.startDate);
            const periodEnd = parseRecordedDate(period.endDate);
            const periodDays = periodStart && periodEnd ? Math.floor((periodEnd.getTime() - periodStart.getTime()) / 86400000) + 1 : 0;
            const monthly = periodDays > 0
                ? Math.round(periodAmount / periodDays * 30.4375)
                : Math.round(periodAmount / billingCycleMonths(entry.asset));
            currencyBucket.monthlyAmountMinor = safeAddFormal(currencyBucket.monthlyAmountMinor, monthly, 'subscription.monthlyAmountMinor');
        }
    });
    // 累计支出：所有选中订阅卡（含退役）的未作废订阅付款流出，按 owner 币种入桶。
    sidecars.financialEvents.forEach(event => {
        if (!event || !hasOwn(subscriptionEntryById, event.assetId)) return;
        if (event.eventType !== FINANCIAL_EVENT_TYPE.SUBSCRIPTION_PAYMENT) return;
        if (event.direction !== FINANCIAL_DIRECTION.OUTFLOW) return;
        if (event.voidedAt) return;
        const currency = subscriptionEntryById[event.assetId].card.currency;
        if (!hasOwn(report.subscription.byCurrency, currency)) {
            report.subscription.byCurrency[currency] = { currency: currency, paidAmountMinor: 0, monthlyAmountMinor: 0, activeCount: 0 };
        }
        const currencyBucket = report.subscription.byCurrency[currency];
        currencyBucket.paidAmountMinor = safeAddFormal(currencyBucket.paidAmountMinor, event.amountMinor, 'subscription.paidAmountMinor');
    });
    // 即将续期：复用 risks.renewal.plannedWithin30Days 条目，补当期付款金额与币种。
    report.subscription.upcomingRenewals = report.risks.renewal.plannedWithin30Days
        .map(entry => {
            const found = hasOwn(subscriptionEntryById, entry.assetId) ? subscriptionEntryById[entry.assetId] : null;
            const card = found ? found.card : null;
            return {
                assetId: entry.assetId,
                date: entry.date,
                daysRemaining: entry.daysRemaining,
                amountMinor: card && card.subscription ? periodPaymentAmountMinor(card.subscription.currentPeriod) : 0,
                currency: card ? card.currency : null,
            };
        })
        .sort((left, right) => left.daysRemaining - right.daysRemaining);

    // v2.6.3 预付扩展：利用率 = 消费 / 充值（原始比值不取整）；未来 30 天
    // 内到期的预付卡按剩余天数升序，口径与 formalRiskEntry 一致。
    Object.keys(report.prepaid.amountByCurrency).forEach(currency => {
        const bucket = report.prepaid.amountByCurrency[currency];
        bucket.utilizationRate = bucket.chargeAmountMinor > 0 ? bucket.consumeAmountMinor / bucket.chargeAmountMinor : 0;
    });
    report.prepaid.expiringWithin30Days = cards
        .filter(card => card.prepaid)
        .map(card => formalRiskEntry(card, card.expiryOn, reference))
        .filter(entry => entry && entry.daysRemaining >= 0 && entry.daysRemaining <= 30)
        .sort((left, right) => left.daysRemaining - right.daysRemaining);

    const selectedIds = new Set(cards.map(card => card.id));
    sidecars.maintenance.forEach(record => {
        if (!selectedIds.has(record.assetId)) return;
        const owner = assets.find(asset => asset.id === record.assetId);
        const event = record.financialEventId == null ? null : sidecars.financialEvents.find(item => item.id === record.financialEventId);
        if (record.financialEventId != null && (!event || event.assetId !== record.assetId || event.eventType !== 'maintenance'
            || event.currency !== owner.currency || event.direction !== 'outflow' || event.voidedAt)) {
            throw formalReportError('maintenance financialEventId references no compatible financial event');
        }
        const currency = owner.currency;
        if (!hasOwn(report.maintenance.costByCurrency, currency)) {
            report.maintenance.costByCurrency[currency] = { currency, cost: 0, recordCount: 0 };
        }
        const bucket = report.maintenance.costByCurrency[currency];
        bucket.cost = safeAddFormal(bucket.cost, event ? event.amountMinor : 0, 'maintenance.costAmountMinor');
        bucket.costAmountMinor = bucket.cost;
        bucket.recordCount = safeAddFormal(bucket.recordCount, 1, 'maintenance.recordCount');
        report.maintenance.recordCount = safeAddFormal(report.maintenance.recordCount, 1, 'maintenance.recordCount');
        report.dataCoverage.maintenance.selected = safeAddFormal(report.dataCoverage.maintenance.selected, 1, 'maintenance.selected');
    });
    sidecars.lifecycleEvents.forEach(record => {
        if (selectedIds.has(record.assetId)) report.dataCoverage.lifecycleEvents.selected = safeAddFormal(
            report.dataCoverage.lifecycleEvents.selected, 1, 'lifecycleEvents.selected');
    });
    report.tags.uniqueCount = Object.keys(report.tags.byTagId).length;
    // v2.6.5 阶段3a：维度去重计数（与 tags.uniqueCount 同口径 = 引用中的去重条目数）。
    report.brand.uniqueCount = Object.keys(report.brand.byId).length;
    report.channel.uniqueCount = Object.keys(report.channel.byId).length;
    Object.keys(report.rankings.byCurrency).forEach(currency => report.rankings.byCurrency[currency].sort((left, right) => {
        if (left.netAmountMinor === right.netAmountMinor) return left.name.localeCompare(right.name);
        return left.netAmountMinor < right.netAmountMinor ? 1 : -1;
    }));
    return deepFreeze(report);
}

function buildFormalDashboard(snapshot, rangeInput, options) {
    const range = normalizeDashboardRange(rangeInput);
    const now = options && options.now;
    const reference = parseRecordedDate(now) || beijingBusinessDateFromInstant(new Date());
    const trend = dashboardTrendWindow(range, reference);
    const report = buildFormalReport(snapshot, {
        dateFrom: dayKey(trend.start),
        endDate: dayKey(trend.end),
        months: range === '6m' ? 6 : 12,
    }, { now: now });
    const dashboard = {
        schemaGeneration: 'formal-v2',
        range: range,
        referenceDate: report.filter.endDate,
        summary: { total: report.counts.total, byStatus: report.counts.byStatus },
        currencies: Object.fromEntries(Object.entries(report.amounts.netByCurrency).map(([currency, bucket]) => [currency,
            Object.assign({}, bucket, { amountMinor: bucket.netAmountMinor })])),
        composition: { byKind: report.counts.byKind },
        trend: report.trends,
        risks: report.risks,
        maintenance: report.maintenance,
        dataCoverage: report.dataCoverage,
    };
    return deepFreeze(dashboard);
}

const DASHBOARD_RANGES = Object.freeze(['30d', '6m', '12m']);

function normalizeDashboardRange(value) {
    return DASHBOARD_RANGES.includes(value) ? value : '12m';
}

function dashboardTrendWindow(range, reference) {
    const referenceDay = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()));
    if (range === '30d') {
        const start = new Date(referenceDay.getTime() - 29 * 86400000);
        const buckets = [];
        for (let index = 0; index < 5; index++) {
            const bucketStart = new Date(start.getTime() + index * 7 * 86400000);
            if (bucketStart > referenceDay) break;
            const bucketEnd = new Date(Math.min(referenceDay.getTime(), bucketStart.getTime() + 6 * 86400000));
            buckets.push({
                key: dayKey(bucketStart),
                label: dayKey(bucketStart).slice(5),
                startDate: dayKey(bucketStart),
                endDate: dayKey(bucketEnd),
                count: 0,
            });
        }
        return { mode: 'week', start: start, end: referenceDay, buckets: buckets };
    }

    const months = range === '6m' ? 6 : 12;
    const startMonth = new Date(Date.UTC(referenceDay.getUTCFullYear(), referenceDay.getUTCMonth() - months + 1, 1));
    const buckets = [];
    for (let index = 0; index < months; index++) {
        const bucketStart = new Date(Date.UTC(startMonth.getUTCFullYear(), startMonth.getUTCMonth() + index, 1));
        const nextMonth = new Date(Date.UTC(bucketStart.getUTCFullYear(), bucketStart.getUTCMonth() + 1, 1));
        const bucketEnd = new Date(Math.min(referenceDay.getTime(), nextMonth.getTime() - 86400000));
        buckets.push({
            key: monthKey(bucketStart),
            label: String(bucketStart.getUTCMonth() + 1),
            startDate: dayKey(bucketStart),
            endDate: dayKey(bucketEnd),
            count: 0,
        });
    }
    return { mode: 'month', start: startMonth, end: referenceDay, buckets: buckets };
}

// v2.4.2 心动值投影。计数严格从 wishlistEvents 事件流派生
// （eventType === 'heartbeat'），主表不落缓存；UI 层负责封顶与渲染。
function deriveWishlistHeartbeat(events, assetId) {
    if (!Array.isArray(events)) return { count: 0 };
    let count = 0;
    for (let index = 0; index < events.length; index++) {
        const event = events[index];
        if (event && event.eventType === 'heartbeat' && event.sourceWishlistId === assetId) count += 1;
    }
    return { count: count };
}

// 有目标（target 为 ≥1 的安全整数）：ratio = count / target（数值，UI 层自行
// 封顶），reached = count >= target；阶段按 ratio 分档。
// 无目标（target 为 null / 非法）：ratio = null，reached = false；阶段按
// 计数里程碑分档（0 / 1-4 / 5-9 / 10-19 / ≥20）。
function describeWishlistHeartbeat(count, target) {
    const total = Number.isSafeInteger(count) && count > 0 ? count : 0;
    const hasTarget = Number.isSafeInteger(target) && target >= 1;
    if (!hasTarget) {
        const stage = total === 0 ? ['seed', '🌰']
            : total < 5 ? ['sprout', '🌱']
            : total < 10 ? ['growing', '🌿']
            : total < 20 ? ['thriving', '☘️']
            : ['bloom', '🌸'];
        return { ratio: null, stageKey: stage[0], emoji: stage[1], reached: false };
    }
    const ratio = total / target;
    const reached = total >= target;
    const stage = total === 0 ? ['seed', '🌰']
        : ratio < 0.25 ? ['sprout', '🌱']
        : ratio < 0.5 ? ['growing', '🌿']
        : ratio < 0.75 ? ['thriving', '☘️']
        : ratio < 1 ? ['budding', '🌷']
        : ['bloom', '🌸'];
    return { ratio: ratio, stageKey: stage[0], emoji: stage[1], reached: reached };
}

module.exports = {
    DASHBOARD_RANGES: DASHBOARD_RANGES,
    normalizeDashboardRange: normalizeDashboardRange,
    normalizeFormalReportFilter: normalizeFormalReportFilter,
    buildFormalReport: buildFormalReport,
    buildFormalDashboard: buildFormalDashboard,
    deriveWishlistHeartbeat: deriveWishlistHeartbeat,
    describeWishlistHeartbeat: describeWishlistHeartbeat,
};

},
"src/store.js": function(module, exports, __require, externalRequire) {
'use strict';
const { validateFormalV2Asset, validateFinancialRecord, projectFormalFinancials } = __require("api/assets.js");

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

},
"src/asset-actions.js": function(module, exports, __require, externalRequire) {
'use strict';
const { newFormalV2Asset, mergeFormalV2AssetPatch, validateFormalV2Asset, normalizeFinancialRecord, validateFinancialRecord, projectFormalFinancials } = __require("api/assets.js");
const { todayISO } = __require("api/algorithms.js");
const DEFAULT_CATEGORY = Object.freeze({ physical: 'otherPhysical', virtualSubscription: 'otherVirtual', virtualPerpetual: 'otherVirtual', prepaidAmount: 'prepaidAmount', prepaidCount: 'prepaidCount' });
function parseAmount(value, currency) {
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  const text = String(value).trim();
  if (!new RegExp('^\\d+(?:\\.\\d{1,' + Math.max(1, digits) + '})?$').test(text) || (digits === 0 && text.includes('.'))) throw new Error('金额必须为非负数，精度符合资产货币');
  const [whole, fraction = ''] = text.split('.');
  const minor = BigInt(whole) * (10n ** BigInt(digits)) + BigInt(fraction.padEnd(digits, '0') || '0');
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('金额超出安全范围');
  return Number(minor);
}
function assetFinancials(snapshot, asset) {
  return projectFormalFinancials(asset, snapshot.financialEvents.events.filter(event => event && event.assetId === asset.id));
}
function purchaseAmountText(snapshot, asset) {
  const purchases = snapshot.financialEvents.events.filter(event => event && event.assetId === asset.id && event.eventType === 'purchase' && !event.voidedAt);
  assetFinancials(snapshot, asset);
  if (purchases.length > 1) throw new Error('存在多条有效购买事件，不能通过简易表单更正');
  if (!purchases.length) return '';
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency: asset.currency }).resolvedOptions().maximumFractionDigits;
  const minor = BigInt(purchases[0].amountMinor);
  const scale = 10n ** BigInt(digits);
  return (minor / scale).toString() + (digits ? '.' + (minor % scale).toString().padStart(digits, '0') : '');
}
function saveAssetInput(snapshot, input, existingId, options = {}) {
  const now = options.now || new Date().toISOString();
  const index = existingId == null ? -1 : snapshot.assets.assets.findIndex(asset => asset && asset.id === existingId);
  if (existingId != null && index < 0) throw new Error('资产已被删除，请重新打开表单');
  const current = index < 0 ? null : snapshot.assets.assets[index];
  if (current && input.kind !== current.kind) throw new Error('编辑时不允许改变资产类型');
  if (current && options.expectedAsset && JSON.stringify(current) !== JSON.stringify(options.expectedAsset)) throw new Error('资产已修改，请重新打开表单');
  const wishlist = current && current.status === 'wishlist';
  const patch = wishlist ? { name: input.name.trim() } : { name: input.name.trim(), acquiredOn: input.acquiredOn || todayISO() };
  const asset = current ? mergeFormalV2AssetPatch(current, patch, { now }) : newFormalV2Asset({
    ...patch, kind: input.kind, status: 'active', statusChangedOn: patch.acquiredOn,
    categoryId: DEFAULT_CATEGORY[input.kind], currency: input.currency || 'CNY', details: {}, cover: { kind: 'none' },
  }, { now });
  if (!validateFormalV2Asset(asset).valid) throw new Error('资产字段不符合正式数据契约');
  if (!wishlist && input.amount !== undefined) {
    const amountMinor = parseAmount(input.amount, asset.currency);
    const events = snapshot.financialEvents.events;
    const owned = events.filter(event => event && event.assetId === asset.id);
    projectFormalFinancials(asset, owned);
    const purchases = owned.filter(event => event.eventType === 'purchase' && !event.voidedAt);
    if (purchases.length > 1) throw new Error('多条购买事件不能通过简易表单更正');
    const original = purchases[0];
    if (!original || original.amountMinor !== amountMinor || original.effectiveDate !== asset.acquiredOn) {
      const event = normalizeFinancialRecord({ assetId: asset.id, eventType: 'purchase', direction: 'outflow', currency: asset.currency, amountMinor,
        effectiveDate: asset.acquiredOn, replacesEventId: original ? original.id : null }, { now });
      const validation = validateFinancialRecord(event);
      if (!validation.valid) throw new Error(validation.errors.join('; '));
      if (original) original.voidedAt = now;
      events.push(event);
      projectFormalFinancials(asset, events.filter(record => record && record.assetId === asset.id));
    }
  }
  if (index < 0) snapshot.assets.assets.push(asset); else snapshot.assets.assets[index] = asset;
  return asset;
}
function deleteAssetRecords(snapshot, id) {
  snapshot.assets.assets = snapshot.assets.assets.filter(asset => !asset || asset.id !== id);
  for (const [key, field] of Object.entries({ wishlistEvents: 'events', operationLogs: 'logs', maintenance: 'records', usage: 'records', prepaidTransactions: 'records', financialEvents: 'events', lifecycleEvents: 'events', subscriptionPeriods: 'records' })) {
    snapshot[key][field] = snapshot[key][field].filter(record => !record || record.assetId !== id);
  }
}
module.exports = { DEFAULT_CATEGORY, parseAmount, assetFinancials, purchaseAmountText, saveAssetInput, deleteAssetRecords };

}
};
const cache = Object.create(null);
function __require(id) {
 if (cache[id]) return cache[id].exports;
 if (!Object.prototype.hasOwnProperty.call(factories, id)) throw new Error("未知模块：" + id);
 const module = cache[id] = { exports: {} };
 factories[id](module, module.exports, __require, externalRequire);
 return module.exports;
}
return __require("src/main.js");
})(require);
