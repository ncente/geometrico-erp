// Generador de folios consecutivos por año: COT-2026-0001, PED-2026-0001.
import db from './db.js';

export function siguienteFolio(prefijo, tabla) {
  const year = new Date().getFullYear();
  const like = `${prefijo}-${year}-%`;
  const row = db
    .prepare(`SELECT numero FROM ${tabla} WHERE numero LIKE ? ORDER BY id DESC LIMIT 1`)
    .get(like);
  let next = 1;
  if (row) {
    const parts = row.numero.split('-');
    const n = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(n)) next = n + 1;
  }
  return `${prefijo}-${year}-${String(next).padStart(4, '0')}`;
}
