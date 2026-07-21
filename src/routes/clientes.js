import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM clientes ORDER BY nombre COLLATE NOCASE').all();
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Cliente no encontrado' });
  res.json(row);
});

router.post('/', (req, res) => {
  const { nombre, telefono, email, tipo, ciudad, notas } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });
  try {
    const info = db
      .prepare('INSERT INTO clientes (nombre, telefono, email, tipo, ciudad, notas) VALUES (?, ?, ?, ?, ?, ?)')
      .run(nombre, telefono || null, email || null, tipo || 'final', ciudad || null, notas || null);
    res.status(201).json(db.prepare('SELECT * FROM clientes WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Cliente no encontrado' });
  const { nombre, telefono, email, tipo, ciudad, notas } = req.body;
  db.prepare(
    'UPDATE clientes SET nombre = ?, telefono = ?, email = ?, tipo = ?, ciudad = ?, notas = ? WHERE id = ?'
  ).run(
    nombre ?? existing.nombre,
    telefono ?? existing.telefono,
    email ?? existing.email,
    tipo ?? existing.tipo,
    ciudad ?? existing.ciudad,
    notas ?? existing.notas,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM clientes WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Cliente no encontrado' });
  res.json({ ok: true });
});

export default router;
