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

// Resumen: separa ingreso bruto (lo que paga el cliente) de utilidad real.
// - ingresos_confirmados: ventas ya despachadas y cobradas (cash-in real)
// - costo_venta: COGS auto-registrado al despachar (categoria='costo_produccion')
// - utilidad_bruta: ingresos - costo_venta (lo que de verdad ganaste, no lo que facturaste)
// - gastos_operativos: todo lo demás (nómina, marketing, arriendo... categoria != 'costo_produccion')
// - utilidad_neta: utilidad_bruta - gastos_operativos
// - salud_caja: ingresos_confirmados - TODOS los gastos (COGS + operativos) = caja real disponible
router.get('/resumen', (req, res) => {
  const ingresosConfirmados = db
    .prepare(`SELECT COALESCE(SUM(monto),0) AS s FROM transacciones_financieras WHERE tipo='ingreso' AND estado='confirmado'`)
    .get().s;
  const ingresosProyectados = db
    .prepare(`SELECT COALESCE(SUM(monto),0) AS s FROM transacciones_financieras WHERE tipo='ingreso' AND estado='proyectado'`)
    .get().s;
  const costoVenta = db
    .prepare(`SELECT COALESCE(SUM(monto),0) AS s FROM transacciones_financieras WHERE tipo='gasto' AND categoria='costo_produccion'`)
    .get().s;
  const gastosOperativos = db
    .prepare(`SELECT COALESCE(SUM(monto),0) AS s FROM transacciones_financieras WHERE tipo='gasto' AND categoria!='costo_produccion'`)
    .get().s;
  const gastosTotales = costoVenta + gastosOperativos;

  const utilidadBruta = ingresosConfirmados - costoVenta;
  const utilidadNeta = utilidadBruta - gastosOperativos;
  const margenBrutoPct = ingresosConfirmados > 0 ? (utilidadBruta / ingresosConfirmados) * 100 : 0;

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

  // Tendencia mensual (últimos 6 meses) — ingresos confirmados vs gastos totales por mes
  const tendenciaMensual = db
    .prepare(
      `SELECT strftime('%Y-%m', fecha) AS mes,
              COALESCE(SUM(CASE WHEN tipo='ingreso' AND estado='confirmado' THEN monto ELSE 0 END),0) AS ingresos,
              COALESCE(SUM(CASE WHEN tipo='gasto' AND categoria='costo_produccion' THEN monto ELSE 0 END),0) AS costo_venta,
              COALESCE(SUM(CASE WHEN tipo='gasto' AND categoria!='costo_produccion' THEN monto ELSE 0 END),0) AS gastos_operativos
       FROM transacciones_financieras
       WHERE fecha >= date('now','-6 months')
       GROUP BY mes ORDER BY mes`
    )
    .all();

  res.json({
    salud_caja: ingresosConfirmados - gastosTotales,
    ingresos_confirmados: ingresosConfirmados,
    ingresos_proyectados: ingresosProyectados,
    costo_venta: costoVenta,
    gastos_operativos: gastosOperativos,
    gastos: gastosTotales, // compatibilidad con versiones anteriores del panel
    utilidad_bruta: utilidadBruta,
    utilidad_neta: utilidadNeta,
    margen_bruto_pct: margenBrutoPct,
    por_categoria: porCategoria,
    margen_por_producto: margenPorProducto,
    tendencia_mensual: tendenciaMensual,
  });
});

export default router;
