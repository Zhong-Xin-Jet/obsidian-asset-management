'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const path = require('node:path');
class Element {
  constructor() { this.children = []; this.settings = []; }
  empty() { this.children = []; this.settings = []; }
  addClass() {}
  createDiv(options = {}) { return this.createEl('div', options); }
  createSpan(options = {}) { return this.createEl('span', options); }
  createEl(tag, options = {}) { const el = new Element(); Object.assign(el, options, { tag }); this.children.push(el); return el; }
}
class Control {
  constructor() { this.options = {}; }
  setValue(value) { this.value = value; return this; }
  onChange(fn) { this.change = fn; return this; }
  setDisabled(value) { this.disabled = value; return this; }
  addOption(value, label) { this.options[value] = label; return this; }
  setButtonText(value) { this.value = value; return this; }
  setCta() { return this; }
  onClick(fn) { this.click = fn; return this; }
}
class Setting {
  constructor(el) { el.settings.push(this); }
  setName(name) { this.name = name; return this; }
  setDesc(desc) { this.desc = desc; return this; }
  addText(fn) { this.text = new Control(); fn(this.text); return this; }
  addDropdown(fn) { this.dropdown = new Control(); fn(this.dropdown); return this; }
  addButton(fn) { this.button = new Control(); fn(this.button); return this; }
}
const mock = {
  Plugin: class {
    async loadData() { return this.savedSettings || {}; }
    async saveData(data) { this.savedSettings = data; }
    registerView(type, factory) { this.viewFactory = factory; }
    addRibbonIcon() {}
    addCommand(command) { (this.commands ||= []).push(command); }
    addSettingTab(tab) { this.tab = tab; }
  },
  ItemView: class { constructor(leaf) { this.app = leaf.app; this.containerEl = new Element(); } },
  Modal: class { constructor(app) { this.app = app; this.contentEl = new Element(); } open() { mock.lastModal = this; this.onOpen(); } close() { this.closed = true; } },
  PluginSettingTab: class { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = new Element(); } },
  Setting,
  Notice: class { constructor(message) { mock.notices.push(message); } },
  notices: [],
};
function loadPlugin(filename = path.resolve(__dirname, '../src/main.js')) {
  const module = { exports: {} };
  const localRequire = createRequire(filename);
  const requireMock = id => id === 'obsidian' ? mock : localRequire(id);
  vm.runInThisContext('(function(require,module,exports){' + fs.readFileSync(filename, 'utf8') + '\n})', { filename })(requireMock, module, module.exports);
  return module.exports;
}
function fixture(body) {
  const files = new Map();
  const directories = new Set();
  const dataPath = '.asset-management/data.json';
  if (body !== undefined) files.set(dataPath, typeof body === 'string' ? body : JSON.stringify(body));
  const adapter = {
    reads: 0, writes: 0, failRead: false, failWrite: false, failExists: false,
    async exists(file) { if (this.failExists) throw new Error('存在检查失败'); return files.has(file) || directories.has(file); },
    async read(file) { this.reads++; if (this.failRead) throw new Error('读取失败'); if (!files.has(file)) throw new Error('文件消失'); return files.get(file); },
    async mkdir(dir) { directories.add(dir); },
    async write(file, content) { this.writes++; if (this.failWrite) throw new Error('保存失败'); files.set(file, content); },
  };
  const vault = { adapter, getAbstractFileByPath() { throw new Error('禁止使用隐藏目录索引'); }, async create(file, content) { if (files.has(file)) throw new Error('文件已存在'); files.set(file, content); } };
  const app = { vault, workspace: { getLeavesOfType: () => [], detachLeavesOfType() {} } };
  return { app, settings: { dataPath, preferredCurrency: 'CNY' }, files, directories, adapter, dataPath };
}
module.exports = { mock, loadPlugin, fixture };
