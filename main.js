const { Plugin, ItemView, Modal, Notice, Setting, PluginSettingTab, requestUrl, normalizePath, TFile } = require('obsidian');
const {
  FORMAL_ASSET_KIND,
  FORMAL_ASSET_KINDS,
  ASSET_STATUS,
  newFormalV2Asset,
  validateFormalV2Asset,
  mergeFormalV2AssetPatch,
  projectFormalAsset,
  computeStats,
  applyFilter,
  sortAssets,
} = require('./api/assets');
const { buildFormalReport, buildFormalDashboard } = require('./api/report');
const { createStableId, todayISO, formatAmountMinor } = require('./api/algorithms');

const VIEW_TYPE_ASSET_MANAGEMENT = 'asset-management-view';
const DEFAULT_SETTINGS = {
  dataPath: '.asset-management/data.json',
  preferredCurrency: 'CNY',
  currencyDisplayMode: 'native',
  defaultStatus: 'all',
  defaultSort: 'newest',
};

class AssetStore {
  constructor(plugin) {
    this.plugin = plugin;
    this.snapshot = this.emptySnapshot();
  }
  emptySnapshot() {
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
  async load() {
    const path = normalizePath(this.plugin.settings.dataPath);
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (!file) { this.snapshot = this.emptySnapshot(); return this.snapshot; }
    try {
      const raw = JSON.parse(await this.plugin.app.vault.read(file));
      this.snapshot = this.normalizeSnapshot(raw);
    } catch (error) {
      new Notice('资产数据读取失败，已使用空数据：' + error.message);
      this.snapshot = this.emptySnapshot();
    }
    return this.snapshot;
  }
  normalizeSnapshot(raw) {
    const base = this.emptySnapshot();
    const source = raw && typeof raw === 'object' ? raw : {};
    const assets = source.assets && Array.isArray(source.assets.assets) ? source.assets.assets : [];
    base.assets.assets = assets.filter(asset => validateFormalV2Asset(asset).valid);
    for (const key of Object.keys(base)) {
      if (key === 'assets') continue;
      if (source[key] && typeof source[key] === 'object') base[key] = Object.assign(base[key], source[key]);
    }
    return base;
  }
  async save() {
    const path = normalizePath(this.plugin.settings.dataPath);
    const parent = path.split('/').slice(0, -1).join('/');
    if (parent && !this.plugin.app.vault.getAbstractFileByPath(parent)) await this.plugin.app.vault.createFolder(parent);
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    const body = JSON.stringify(this.snapshot, null, 2);
    if (file instanceof TFile) await this.plugin.app.vault.modify(file, body);
    else await this.plugin.app.vault.create(path, body);
  }
  async mutate(mutator) {
    const result = await mutator(this.snapshot);
    await this.save();
    return result;
  }
}

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
    const stats = computeStats(assets.filter(asset => asset.status !== ASSET_STATUS.WISHLIST));
    const dashboard = safeDashboard(snapshot);
    const header = root.createDiv({ cls: 'am-header' });
    header.createEl('h2', { text: '资产管理' });
    const actions = header.createDiv({ cls: 'am-actions' });
    const add = actions.createEl('button', { text: '新增资产', cls: 'mod-cta' });
    add.onclick = () => new AssetModal(this.app, this.plugin, null, () => this.render()).open();
    const backup = actions.createEl('button', { text: '导出 JSON' });
    backup.onclick = () => this.plugin.exportBackup();
    const summary = root.createDiv({ cls: 'am-summary' });
    summary.createDiv({ text: `资产 ${stats.total || assets.length}` });
    summary.createDiv({ text: `在役 ${stats.active || assets.filter(a => a.status === 'active').length}` });
    summary.createDiv({ text: `种草 ${assets.filter(a => a.status === 'wishlist').length}` });
    summary.createDiv({ text: `报表区间 ${dashboard ? dashboard.range : '12m'}` });
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
      const title = card.createDiv({ cls: 'am-card-title' });
      title.createEl('strong', { text: asset.name });
      title.createSpan({ text: asset.status === 'wishlist' ? '种草' : asset.status === 'active' ? '在役' : '退役', cls: `am-status am-status-${asset.status}` });
      card.createDiv({ text: `${kindLabel(asset.kind)} · ${asset.categoryId || '未分类'} · ${asset.acquiredOn || '未购入'}`, cls: 'am-meta' });
      if (asset.status !== 'wishlist') {
        const amountMinor = asset.details && Number.isSafeInteger(asset.details.purchaseAmountMinor) ? asset.details.purchaseAmountMinor : 0;
        card.createDiv({ text: formatAmountMinor(amountMinor, asset.currency, 'zh-CN'), cls: 'am-money' });
      }
      const buttons = card.createDiv({ cls: 'am-card-actions' });
      const edit = buttons.createEl('button', { text: '编辑' });
      edit.onclick = () => new AssetModal(this.app, this.plugin, asset, () => this.render()).open();
      const del = buttons.createEl('button', { text: '删除', cls: 'mod-warning' });
      del.onclick = async () => { if (confirm(`确定删除“${asset.name}”吗？`)) { await this.plugin.deleteAsset(asset.id); await this.render(); } };
    }
  }
}

class AssetModal extends Modal {
  constructor(app, plugin, asset, onSaved) { super(app); this.plugin = plugin; this.asset = asset; this.onSaved = onSaved; }
  onOpen() {
    const { contentEl } = this; contentEl.empty(); contentEl.addClass('am-modal');
    contentEl.createEl('h2', { text: this.asset ? '编辑资产' : '新增资产' });
    let name = this.asset?.name || ''; let kind = this.asset?.kind || FORMAL_ASSET_KIND.PHYSICAL; let amount = '';
    new Setting(contentEl).setName('名称').addText(text => text.setValue(name).onChange(value => { name = value; }));
    new Setting(contentEl).setName('类型').addDropdown(drop => { for (const value of FORMAL_ASSET_KINDS) drop.addOption(value, kindLabel(value)); drop.setValue(kind); drop.onChange(value => { kind = value; }); });
    new Setting(contentEl).setName('购买金额（元）').addText(text => text.setValue('').onChange(value => { amount = value; }));
    new Setting(contentEl).setName('购买日期').addText(text => text.setValue(this.asset?.acquiredOn || todayISO()).onChange(value => { this.acquiredOn = value; }));
    new Setting(contentEl).addButton(button => button.setButtonText('保存').setCta().onClick(async () => {
      try {
        const now = new Date().toISOString();
        const data = this.asset ? mergeFormalV2AssetPatch(this.asset, { name: name.trim(), acquiredOn: this.acquiredOn || this.asset.acquiredOn }) : newFormalV2Asset({ name: name.trim(), kind, status: 'active', acquiredOn: this.acquiredOn || todayISO(), statusChangedOn: this.acquiredOn || todayISO(), categoryId: kind === FORMAL_ASSET_KIND.PHYSICAL ? 'otherPhysical' : (kind === FORMAL_ASSET_KIND.VIRTUAL_SUBSCRIPTION ? 'otherVirtual' : kind), details: {} }, { now });
        if (!validateFormalV2Asset(data).valid) throw new Error('资产字段不符合正式数据契约');
        await this.plugin.saveAsset(data); this.close(); this.onSaved?.();
      } catch (error) { new Notice('保存失败：' + error.message); }
    }));
  }
}

class AssetManagementSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this; containerEl.empty();
    containerEl.createEl('h2', { text: '资产管理设置' });
    new Setting(containerEl).setName('数据文件').setDesc('Vault 内的 JSON 数据文件路径').addText(text => text.setValue(this.plugin.settings.dataPath).onChange(async value => { this.plugin.settings.dataPath = normalizePath(value || DEFAULT_SETTINGS.dataPath); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('首选货币').addText(text => text.setValue(this.plugin.settings.preferredCurrency).onChange(async value => { this.plugin.settings.preferredCurrency = value.trim().toUpperCase() || 'CNY'; await this.plugin.saveSettings(); }));
  }
}

function kindLabel(kind) { return ({ physical: '实物', virtualSubscription: '虚拟订阅', virtualPerpetual: '永久授权', prepaidAmount: '金额预付', prepaidCount: '次数预付' })[kind] || kind; }
function safeDashboard(snapshot) { try { return buildFormalDashboard(snapshot, '12m'); } catch (_) { return null; } }

module.exports = class AssetManagementPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.store = new AssetStore(this); await this.store.load();
    this.registerView(VIEW_TYPE_ASSET_MANAGEMENT, leaf => new AssetManagementView(leaf, this));
    this.addRibbonIcon('package', '打开资产管理', () => this.activateView());
    this.addCommand({ id: 'open-asset-management', name: '打开资产管理', callback: () => this.activateView() });
    this.addCommand({ id: 'add-asset', name: '新增资产', callback: () => new AssetModal(this.app, this, null, () => this.refreshViews()).open() });
    this.addSettingTab(new AssetManagementSettingTab(this.app, this));
    this.addCommand({ id: 'export-assets-json', name: '导出资产 JSON 备份', callback: () => this.exportBackup() });
  }
  async onunload() { this.app.workspace.detachLeavesOfType(VIEW_TYPE_ASSET_MANAGEMENT); }
  async activateView() { const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_ASSET_MANAGEMENT)[0] || this.app.workspace.getRightLeaf(false); await leaf.setViewState({ type: VIEW_TYPE_ASSET_MANAGEMENT, active: true }); this.app.workspace.revealLeaf(leaf); }
  async refreshViews() { for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_ASSET_MANAGEMENT)) await leaf.view.render(); }
  async saveSettings() { await this.saveData(this.settings); }
  async saveAsset(asset) { await this.store.mutate(snapshot => { const index = snapshot.assets.assets.findIndex(item => item.id === asset.id); if (index >= 0) snapshot.assets.assets[index] = asset; else snapshot.assets.assets.push(asset); }); await this.refreshViews(); }
  async deleteAsset(id) { await this.store.mutate(snapshot => { snapshot.assets.assets = snapshot.assets.assets.filter(asset => asset.id !== id); }); await this.refreshViews(); }
  async exportBackup() { const path = `asset-management-backup-${todayISO()}.json`; await this.app.vault.create(path, JSON.stringify(this.store.snapshot, null, 2)); new Notice(`已导出 ${path}`); }
};
