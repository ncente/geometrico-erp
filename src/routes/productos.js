import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const soloActivos = req.query.activos === '1';
  const rows = soloActivos
    ? db.prepare('SELECT * FROM productos WHERE activo = 1 ORDER BY nombre').all()
    : db.prepare('SELECT * FROM productos ORDER BY nombre').all();
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM productos WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Producto no encontrado' });
  res.json(row);
});

router.post('/', (req, res) => {
  const { sku, nombre, variante, costo, precio_final, precio_mayorista, imagen_url, activo } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });
  const info = db
    .prepare(
      `INSERT INTO productos (sku, nombre, variante, costo, precio_final, precio_mayorista, imagen_url, activo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      sku || null,
      nombre,
      variante || null,
      costo || 0,
      precio_final || 0,
      precio_mayorista ?? null,
      imagen_url || null,
      activo === undefined ? 1 : (activo ? 1 : 0)
    );
  res.status(201).json(db.prepare('SELECT * FROM productos WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM productos WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Producto no encontrado' });
  const { sku, nombre, variante, costo, precio_final, precio_mayorista, imagen_url, activo } = req.body;
  db.prepare(
    `UPDATE productos SET sku=?, nombre=?, variante=?, costo=?, precio_final=?, precio_mayorista=?, imagen_url=?, activo=? WHERE id=?`
  ).run(
    sku ?? existing.sku,
    nombre ?? existing.nombre,
    variante ?? existing.variante,
    costo ?? existing.costo,
    precio_final ?? existing.precio_final,
    precio_mayorista ?? existing.precio_mayorista,
    imagen_url ?? existing.imagen_url,
    activo === undefined ? existing.activo : (activo ? 1 : 0),
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM productos WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM productos WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Producto no encontrado' });
  res.json({ ok: true });
});

// ── Receta de materiales por producto ──
router.get('/:id/materiales', (req, res) => {
  const rows = db
    .prepare(
      `SELECT pm.id, pm.material_id, m.nombre, m.unidad, pm.cantidad_requerida
       FROM producto_materiales pm JOIN materiales m ON m.id = pm.material_id
       WHERE pm.producto_id = ?`
    )
    .all(req.params.id);
  res.json(rows);
});

router.post('/:id/materiales', (req, res) => {
  const { material_id, cantidad_requerida } = req.body;
  if (!material_id || cantidad_requerida === undefined) {
    return res.status(400).json({ error: 'material_id y cantidad_requerida son requeridos' });
  }
  const info = db
    .prepare('INSERT INTO producto_materiales (producto_id, material_id, cantidad_requerida) VALUES (?, ?, ?)')
    .run(req.params.id, material_id, cantidad_requerida);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.delete('/:id/materiales/:recetaId', (req, res) => {
  const info = db.prepare('DELETE FROM producto_materiales WHERE id = ? AND producto_id = ?').run(req.params.recetaId, req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Receta no encontrada' });
  res.json({ ok: true });
});

export default router;
