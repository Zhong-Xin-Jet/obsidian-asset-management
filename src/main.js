'use strict';
const { Plugin, ItemView, Modal, Notice, Setting, PluginSettingTab } = require('obsidian');
const { FORMAL_ASSET_KIND, FORMAL_ASSET_KINDS, validateFormalV2Asset } = require('../api/assets');
const { buildFormalDashboard } = require('../api/report');
const { todayISO, formatAmountMinor } = require('../api/algorithms');
const { AssetStore } = require('./store');
const { assetFinancials, purchaseAmountText, saveAssetInput, deleteAssetRecords } = require('./asset-actions');

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
