// 将穿搭知识库导出为 Word 兼容文档（.doc）
// 采用 Word 可识别的 HTML 格式，本地生成、不依赖任何服务

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * @param {{title:string, content:string, createdAt:number, categoryLabel?:string}[]} items
 * @returns {Blob}
 */
export function buildWordDoc(items) {
  const now = fmtTime(Date.now());
  const itemsHtml = items.map((it, i) => `
    <div style="margin-bottom:22px; page-break-inside:avoid;">
      <h2 style="font-size:16pt; color:#ff6b81; margin:0 0 6px;">${i + 1}. ${escapeHtml(it.title) || '（无标题）'}</h2>
      <p style="font-size:11pt; color:#888; margin:0 0 8px;">分类：${escapeHtml(it.categoryLabel) || '未分类'}　|　创建时间：${fmtTime(it.createdAt)}</p>
      <p style="font-size:12pt; line-height:1.8; margin:0; white-space:pre-wrap;">${escapeHtml(it.content) || '（无内容）'}</p>
    </div>`).join('');

  const html = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>穿搭柜 · 穿搭技巧知识库</title>
</head>
<body>
  <h1 style="font-size:22pt; color:#2b2b33; text-align:center; border-bottom:2px solid #ff6b81; padding-bottom:10px;">穿搭柜 · 穿搭技巧知识库</h1>
  <p style="font-size:11pt; color:#888; text-align:center; margin:6px 0 24px;">导出时间：${now}　共 ${items.length} 条</p>
  ${itemsHtml}
</body>
</html>`;

  return new Blob([html], { type: 'application/msword;charset=utf-8' });
}
