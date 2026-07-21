import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM materiales ORDER BY nombre').all());
});

router.get('/alertas', (req, res) => {
  const rows = db.prepare('SELECT * FROM materiales WHERE stock_actual <= stock_minimo ORDER BY nombre').all();
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM materiales WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Material no encontrado' });
  res.json(row);
});

router.post('/', (req, res) => {
  const { nombre, unidad, stock_actual, stock_minimo, costo_unitario } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });
  const info = db
    .prepare('INSERT INTO materiales (nombre, unidad, stock_actual, stock_minimo, costo_unitario) VALUES (?, ?, ?, ?, ?)')
    .run(nombre, unidad || 'unidad', stock_actual || 0, stock_minimo || 0, costo_unitario || 0);
  res.status(201).json(db.prepare('SELECT * FROM materiales WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM materiales WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Material no encontrado' });
  const { nombre, unidad, stock_actual, stock_minimo, costo_unitario } = req.body;
  db.prepare(
    'UPDATE materiales SET nombre=?, unidad=?, stock_actual=?, stock_minimo=?, costo_unitario=? WHERE id=?'
  ).run(
    nombre ?? existing.nombre,
    unidad ?? existing.unidad,
    stock_actual ?? existing.stock_actual,
    stock_minimo ?? existing.stock_minimo,
    costo_unitario ?? existing.costo_unitario,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM materiales WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM materiales WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Material no encontrado' });
  res.json({ ok: true });
});

// Movimiento manual de inventario (entrada por compra, ajuste, etc.)
router.post('/:id/movimiento', (req, res) => {
  const { tipo, cantidad, motivo } = req.body;
  if (!['entrada', 'salida', 'ajuste'].includes(tipo)) return res.status(400).json({ error: 'tipo inválido' });
  const material = db.prepare('SELECT * FROM materiales WHERE id = ?').get(req.params.id);
  if (!material) return res.status(404).json({ error: 'Material no encontrado' });

  const delta = tipo === 'salida' ? -Math.abs(cantidad) : Math.abs(cantidad);
  const nuevoStock = tipo === 'ajuste' ? cantidad : material.stock_actual + delta;

  const tx = db.transaction(() => {
    db.prepare('UPDATE materiales SET stock_actual = ? WHERE id = ?').run(nuevoStock, req.params.id);
    db.prepare(
      'INSERT INTO movimientos_inventario (material_id, tipo, cantidad, motivo) VALUES (?, ?, ?, ?)'
    ).run(req.params.id, tipo, cantidad, motivo || null);
  });
  tx();
  res.json(db.prepare('SELECT * FROM materiales WHERE id = ?').get(req.params.id));
});

router.get('/:id/movimientos', (req, res) => {
  res.json(
    db.prepare('SELECT * FROM movimientos_inventario WHERE material_id = ? ORDER BY fecha DESC').all(req.params.id)
  );
});

export default router;
