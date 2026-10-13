'use strict';
const { newFormalV2Asset, mergeFormalV2AssetPatch, validateFormalV2Asset, normalizeFinancialRecord, validateFinancialRecord, projectFormalFinancials } = require('../api/assets');
const { todayISO } = require('../api/algorithms');
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
