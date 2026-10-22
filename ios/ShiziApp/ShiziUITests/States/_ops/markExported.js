// 把备份记成「已导出」（备份页 / 我的页的「上次备份」）：core/backup.markExported，与真人导出完成同一个写入。a: {at: ISO 本地时间, same: false 时签名对不上（= 导出后记录又有改动）}
// 要在 seed 之后调。
const { getStore } = await import('/src/store/store.js');
const { markExported } = await import('/src/core/backup.js');
const r = markExported(getStore(), { at: Date.parse(a.at), sig: a.same === false ? 'sig-before-changes' : null });
if (!r || !r.ok) return { ok: false, error: 'markExported ' + JSON.stringify(r) };
