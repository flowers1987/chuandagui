// 本地数据层：使用 IndexedDB，所有数据仅存于本机，不上传任何服务器
const DB_NAME = 'chuandagui';
const DB_VERSION = 2;

// 穿搭知识默认分类
export const DEFAULT_CATEGORIES = [
  { id: 'cat_style', name: '风格', order: 0 },
  { id: 'cat_color', name: '配色', order: 1 },
  { id: 'cat_slim', name: '修身', order: 2 },
];

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('outfits')) {
        db.createObjectStore('outfits', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('knowledge')) {
        db.createObjectStore('knowledge', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('kbCategories')) {
        const catStore = db.createObjectStore('kbCategories', { keyPath: 'id' });
        // 首次创建时写入默认分类
        const t = e.target.transaction;
        DEFAULT_CATEGORIES.forEach((c) => t.objectStore('kbCategories').put(c));
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(store, mode) {
  return openDB().then((db) => db.transaction(store, mode).objectStore(store));
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---- 穿搭方案 (outfits) ----
export async function getAllOutfits() {
  const store = await tx('outfits', 'readonly');
  const list = await reqToPromise(store.getAll());
  // 按最新创建优先排序
  list.sort((a, b) => b.createdAt - a.createdAt);
  return list;
}

export async function getOutfit(id) {
  const store = await tx('outfits', 'readonly');
  return reqToPromise(store.get(id));
}

export async function putOutfit(outfit) {
  const store = await tx('outfits', 'readwrite');
  return reqToPromise(store.put(outfit));
}

export async function deleteOutfit(id) {
  const store = await tx('outfits', 'readwrite');
  return reqToPromise(store.delete(id));
}

// ---- 穿搭知识 (knowledge) ----
export async function getAllKnowledge() {
  const store = await tx('knowledge', 'readonly');
  const list = await reqToPromise(store.getAll());
  list.sort((a, b) => b.createdAt - a.createdAt);
  return list;
}

export async function putKnowledge(item) {
  const store = await tx('knowledge', 'readwrite');
  return reqToPromise(store.put(item));
}

export async function deleteKnowledge(id) {
  const store = await tx('knowledge', 'readwrite');
  return reqToPromise(store.delete(id));
}

// ---- 知识分类 (kbCategories) ----
export async function getCategories() {
  const store = await tx('kbCategories', 'readonly');
  const list = await reqToPromise(store.getAll());
  list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return list;
}

export async function putCategory(cat) {
  const store = await tx('kbCategories', 'readwrite');
  return reqToPromise(store.put(cat));
}

export async function deleteCategory(id) {
  const store = await tx('kbCategories', 'readwrite');
  return reqToPromise(store.delete(id));
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
