'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function build() {
  const modules = new Map();
  function collect(file) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('模块路径超出工程');
    if (modules.has(relative)) return relative;
    modules.set(relative, '');
    const source = fs.readFileSync(file, 'utf8').replace(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g, (match, quote, request) => {
      if (!request.startsWith('.')) {
        if (request !== 'obsidian') throw new Error('禁止外部依赖：' + request);
        return 'externalRequire("obsidian")';
      }
      let target = path.resolve(path.dirname(file), request);
      if (!path.extname(target)) target += '.js';
      const id = collect(target);
      return '__require(' + JSON.stringify(id) + ')';
    });
    modules.set(relative, source);
    return relative;
  }
  const entry = collect(path.join(root, 'src/main.js'));
  const factories = [...modules].map(([id, source]) => JSON.stringify(id) + ': function(module, exports, __require, externalRequire) {\n' + source + '\n}').join(',\n');
  const bundle = '// 自动生成：请编辑 src/ 和 api/，然后执行构建。\n' +
    'module.exports = (function(externalRequire) {\n"use strict";\nconst factories = {\n' + factories +
    '\n};\nconst cache = Object.create(null);\nfunction __require(id) {\n if (cache[id]) return cache[id].exports;\n if (!Object.prototype.hasOwnProperty.call(factories, id)) throw new Error("未知模块：" + id);\n const module = cache[id] = { exports: {} };\n factories[id](module, module.exports, __require, externalRequire);\n return module.exports;\n}\nreturn __require(' + JSON.stringify(entry) + ');\n})(require);\n';
  fs.writeFileSync(path.join(root, 'main.js'), bundle);
  console.log('构建成功：main.js，' + modules.size + ' 个内部模块，' + Buffer.byteLength(bundle) + ' 字节');
  return bundle;
}
if (require.main === module) build();
module.exports = { build };
