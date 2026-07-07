/* Tiny IndexedDB layer: `recipes` store + `settings` key/value store. */
(function () {
  'use strict';

  const DB_NAME = 'recipebox';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('recipes')) {
          const store = db.createObjectStore('recipes', { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(storeName, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(storeName, mode);
      const store = t.objectStore(storeName);
      const out = fn(store);
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  window.RB_DB = {
    async allRecipes() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const req = db.transaction('recipes').objectStore('recipes').getAll();
        req.onsuccess = () => {
          const list = req.result || [];
          list.sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt));
          resolve(list);
        };
        req.onerror = () => reject(req.error);
      });
    },
    saveRecipe(recipe) { return tx('recipes', 'readwrite', s => s.put(recipe)); },
    deleteRecipe(id) { return tx('recipes', 'readwrite', s => s.delete(id)); },
    async getSetting(key, fallback) {
      const db = await open();
      return new Promise((resolve) => {
        const req = db.transaction('settings').objectStore('settings').get(key);
        req.onsuccess = () => resolve(req.result === undefined ? fallback : req.result);
        req.onerror = () => resolve(fallback);
      });
    },
    setSetting(key, value) { return tx('settings', 'readwrite', s => s.put(value, key)); },
  };
})();
