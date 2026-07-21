import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM transacciones_financieras ORDER BY fecha DESC, id DESC').all());
});

router.post('/', (req, res) => {
  const { tipo, categoria, monto, descripcion, fecha, estado } = req.body;
  if (!['ingreso', 'gasto'].includes(tipo)) return res.status(400).json({ error: 'tipo debe ser ingreso o gasto' });
  if (!monto) return res.status(400).json({ error: 'monto es requerido' });
  const info = db
    .prepare(
      `INSERT INTO transacciones_financieras (tipo, categoria, monto, estado, descripcion, fecha)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(tipo, categoria || 'otros', monto, estado || 'confirmado', descripcion || null, fecha || new Date().toISOString().slice(0, 10));
  res.status(201).json(db.prepare('SELECT * FROM transacciones_financieras WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM transacciones_financieras WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Transacción no encontrada' });
  res.json({ ok: true });
});

// Resumen: ingresos/gastos confirmados vs proyectados, margen por producto, salud de caja
router.get('/resumen', (req, res) => {
  const ingresosConfirmados = db
    .prepare(`SELECT COALESCE(SUM(monto),0) AS s FROM transacciones_financieras WHERE tipo='ingreso' AND estado='confirmado'`)
    .get().s;
  const ingresosProyectados = db
    .prepare(`SELECT COALESCE(SUM(monto),0) AS s FROM transacciones_financieras WHERE tipo='ingreso' AND estado='proyectado'`)
    .get().s;
  const gastos = db.prepare(`SELECT COALESCE(SUM(monto),0) AS s FROM transacciones_financieras WHERE tipo='gasto'`).get().s;

  const porCategoria = db
    .prepare(
      `SELECT tipo, categoria, COALESCE(SUM(monto),0) AS total FROM transacciones_financieras GROUP BY tipo, categoria ORDER BY total DESC`
    )
    .all();

  // Margen por producto: ventas despachadas (pedido_items) vs costo del producto
  const margenPorProducto = db
    .prepare(
      `SELECT p.id, p.nombre,
              COALESCE(SUM(pi.cantidad),0) AS unidades_vendidas,
              COALESCE(SUM(pi.cantidad * pi.precio_unitario),0) AS ingresos,
              COALESCE(SUM(pi.cantidad * p.costo),0) AS costos,
              COALESCE(SUM(pi.cantidad * (pi.precio_unitario - p.costo)),0) AS utilidad
       FROM pedido_items pi
       JOIN pedidos pe ON pe.id = pi.pedido_id
       JOIN productos p ON p.id = pi.producto_id
       WHERE pe.estado_produccion = 'despachado'
       GROUP BY p.id, p.nombre
       ORDER BY utilidad DESC`
    )
    .all();

  res.json({
    salud_caja: ingresosConfirmados - gastos,
    ingresos_confirmados: ingresosConfirmados,
    ingresos_proyectados: ingresosProyectados,
    gastos,
    por_categoria: porCategoria,
    margen_por_producto: margenPorProducto,
  });
});

export default router;
