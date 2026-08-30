// 极简 ZIP 打包器：STORE 存储方式（不压缩，图片本身已压缩）+ CRC32 校验
// 支持 UTF-8 文件名（设置通用标志位 0x0800），中文季节文件夹名无乱码

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  return { time, date: dosDate };
}

function strBytes(str) {
  return new TextEncoder().encode(str);
}

function u16(view, off, val) { view.setUint16(off, val, true); }
function u32(view, off, val) { view.setUint32(off, val, true); }

/**
 * 打包为 ZIP Blob
 * @param {{name:string, data:Uint8Array}[]} entries 文件条目
 * @param {(ratio:number)=>void} [onProgress] 进度回调 0~1
 */
export async function buildZip(entries, onProgress) {
  const localParts = [];
  const central = [];
  let offset = 0;
  const dt = dosDateTime(new Date());

  for (let i = 0; i < entries.length; i++) {
    const { name, data } = entries[i];
    const nameBytes = strBytes(name);
    const crc = crc32(data);
    const size = data.length;

    // 本地文件头 (30 + name)
    const lh = new Uint8Array(30 + nameBytes.length);
    const lhView = new DataView(lh.buffer);
    u32(lhView, 0, 0x04034b50);
    u16(lhView, 4, 20);          // version needed
    u16(lhView, 6, 0x0800);      // flags: UTF-8
    u16(lhView, 8, 0);           // method: store
    u16(lhView, 10, dt.time);
    u16(lhView, 12, dt.date);
    u32(lhView, 14, crc);
    u32(lhView, 18, size);       // compressed
    u32(lhView, 22, size);       // uncompressed
    u16(lhView, 26, nameBytes.length);
    u16(lhView, 28, 0);          // extra len
    lh.set(nameBytes, 30);

    localParts.push(lh, data);

    // 中央目录头 (46 + name)
    const ch = new Uint8Array(46 + nameBytes.length);
    const chView = new DataView(ch.buffer);
    u32(chView, 0, 0x02014b50);
    u16(chView, 4, 20);          // version made by
    u16(chView, 6, 20);          // version needed
    u16(chView, 8, 0x0800);      // flags: UTF-8
    u16(chView, 10, 0);          // method: store
    u16(chView, 12, dt.time);
    u16(chView, 14, dt.date);
    u32(chView, 16, crc);
    u32(chView, 20, size);
    u32(chView, 24, size);
    u16(chView, 28, nameBytes.length);
    u16(chView, 30, 0);          // extra len
    u16(chView, 32, 0);          // comment len
    u16(chView, 34, 0);          // disk start
    u16(chView, 36, 0);          // internal attrs
    u32(chView, 38, 0);          // external attrs
    u32(chView, 42, offset);     // local header offset
    ch.set(nameBytes, 46);
    central.push(ch);

    offset += lh.length + data.length;

    if (onProgress) onProgress((i + 1) / entries.length);
    // 让出主线程以便 UI 刷新进度
    if ((i & 7) === 0) await new Promise((r) => setTimeout(r, 0));
  }

  // 中央目录整体
  const centralBuf = concat(central);
  // EOCD (22 bytes)
  const eocd = new Uint8Array(22);
  const eView = new DataView(eocd.buffer);
  u32(eView, 0, 0x06054b50);
  u16(eView, 4, 0);
  u16(eView, 6, 0);
  u16(eView, 8, entries.length);
  u16(eView, 10, entries.length);
  u32(eView, 12, centralBuf.length);
  u32(eView, 16, offset);
  u16(eView, 20, 0);

  const all = concat([...localParts, centralBuf, eocd]);
  return new Blob([all], { type: 'application/zip' });
}

function concat(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

// 将图片 Blob 转为 Uint8Array
export async function blobToBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}
