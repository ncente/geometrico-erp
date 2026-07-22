import { Router } from 'express';
import db from '../db.js';
import { siguienteFolio } from '../folios.js';

const router = Router();
const ESTADOS = ['por_fabricar', 'en_produccion', 'listo_despacho', 'despachado'];

function conItems(pedido) {
  const items = db.prepare('SELECT * FROM pedido_items WHERE pedido_id = ?').all(pedido.id);
  const avances = db.prepare('SELECT * FROM pedido_avances WHERE pedido_id = ? ORDER BY fecha').all(pedido.id);
  return { ...pedido, items, avances };
}

// Crea un pedido (usado directo o desde cotización aceptada). Genera ingreso proyectado en finanzas.
export function crearPedido({ cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, cotizacion_id, fecha_pedido, fecha_entrega_estimada, items, total }) {
  const numero = siguienteFolio('PED', 'pedidos');
  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO pedidos (numero, cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, cotizacion_id, fecha_pedido, fecha_entrega_estimada, estado_produccion, total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'por_fabricar', ?)`
      )
      .run(numero, cliente_id || null, cliente_nombre || null, cliente_telefono || null, cliente_direccion || null, cotizacion_id || null, fecha_pedido, fecha_entrega_estimada || null, total || 0);
    const pedidoId = info.lastInsertRowid;

    const insertItem = db.prepare(
      'INSERT INTO pedido_items (pedido_id, producto_id, nombre, cantidad, precio_unitario) VALUES (?, ?, ?, ?, ?)'
    );
    for (const it of items) {
      insertItem.run(pedidoId, it.producto_id || null, it.nombre, it.cantidad, it.precio_unitario);
    }

    db.prepare(`INSERT INTO pedido_avances (pedido_id, estado, nota) VALUES (?, 'por_fabricar', 'Pedido creado')`).run(pedidoId);

    db.prepare(
      `INSERT INTO transacciones_financieras (tipo, categoria, monto, pedido_id, estado, descripcion, fecha)
       VALUES ('ingreso', 'venta', ?, ?, 'proyectado', ?, ?)`
    ).run(total || 0, pedidoId, `Ingreso proyectado — pedido ${numero}`, fecha_pedido);

    return pedidoId;
  });
  const pedidoId = tx();
  return conItems(db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId));
}

export function crearPedidoDesdeCotizacion(cot, items, fecha_entrega_estimada) {
  return crearPedido({
    cliente_id: cot.cliente_id,
    cliente_nombre: cot.cliente_nombre,
    cliente_telefono: cot.cliente_telefono,
    cliente_direccion: cot.cliente_direccion,
    cotizacion_id: cot.id,
    fecha_pedido: new Date().toISOString().slice(0, 10),
    fecha_entrega_estimada,
    items: items.map((it) => ({ producto_id: it.producto_id, nombre: it.nombre, cantidad: it.cantidad, precio_unitario: it.precio_unitario })),
    total: cot.total,
  });
}

router.get('/', (req, res) => {
  const { estado } = req.query;
  const rows = estado
    ? db.prepare('SELECT * FROM pedidos WHERE estado_produccion = ? ORDER BY fecha_entrega_estimada IS NULL, fecha_entrega_estimada').all(estado)
    : db.prepare('SELECT * FROM pedidos ORDER BY id DESC').all();
  res.json(rows.map(conItems));
});

// Cronograma: pedidos no despachados ordenados por fecha de entrega, con bandera de atraso
router.get('/cronograma', (req, res) => {
  const rows = db
    .prepare(`SELECT * FROM pedidos WHERE estado_produccion != 'despachado' ORDER BY fecha_entrega_estimada IS NULL, fecha_entrega_estimada`)
    .all();
  const hoy = new Date().toISOString().slice(0, 10);
  const out = rows.map((p) => ({ ...conItems(p), atrasado: !!(p.fecha_entrega_estimada && p.fecha_entrega_estimada < hoy) }));
  res.json(out);
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Pedido no encontrado' });
  res.json(conItems(row));
});

router.post('/', (req, res) => {
  const { cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, fecha_pedido, fecha_entrega_estimada, items } = req.body;
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items es requerido' });
  const total = items.reduce((s, it) => s + it.precio_unitario * it.cantidad, 0);
  const pedido = crearPedido({
    cliente_id, cliente_nombre, cliente_telefono, cliente_direccion,
    fecha_pedido: fecha_pedido || new Date().toISOString().slice(0, 10),
    fecha_entrega_estimada, items, total,
  });
  res.status(201).json(pedido);
});

// Edición completa — el cliente puede dar teléfono/dirección solo hasta el momento del despacho,
// así que el pedido queda editable sin importar en qué estado esté (por_fabricar..despachado).
// Si se editan los ítems y el pedido aún NO se ha despachado, se recalcula el total y se sincroniza
// el ingreso proyectado en finanzas. Si ya se despachó, el ingreso confirmado queda intacto
// (es un registro contable histórico) y solo se ajusta el total del pedido.
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Pedido no encontrado' });
  const {
    cliente_id, cliente_nombre, cliente_telefono, cliente_direccion,
    fecha_entrega_estimada, items,
  } = req.body;

  const tx = db.transaction(() => {
    let total = existing.total;
    if (Array.isArray(items) && items.length > 0) {
      total = items.reduce((s, it) => s + it.precio_unitario * it.cantidad, 0);
      db.prepare('DELETE FROM pedido_items WHERE pedido_id = ?').run(req.params.id);
      const insertItem = db.prepare(
        'INSERT INTO pedido_items (pedido_id, producto_id, nombre, cantidad, precio_unitario) VALUES (?, ?, ?, ?, ?)'
      );
      for (const it of items) {
        insertItem.run(req.params.id, it.producto_id || null, it.nombre, it.cantidad, it.precio_unitario);
      }
      if (existing.estado_produccion !== 'despachado') {
        db.prepare(
          `UPDATE transacciones_financieras SET monto = ? WHERE pedido_id = ? AND tipo = 'ingreso' AND estado = 'proyectado'`
        ).run(total, req.params.id);
      }
    }
    db.prepare(
      `UPDATE pedidos SET
         cliente_id = ?, cliente_nombre = ?, cliente_telefono = ?, cliente_direccion = ?,
         fecha_entrega_estimada = ?, total = ?
       WHERE id = ?`
    ).run(
      cliente_id !== undefined ? cliente_id : existing.cliente_id,
      cliente_nombre !== undefined ? cliente_nombre : existing.cliente_nombre,
      cliente_telefono !== undefined ? cliente_telefono : existing.cliente_telefono,
      cliente_direccion !== undefined ? cliente_direccion : existing.cliente_direccion,
      fecha_entrega_estimada !== undefined ? fecha_entrega_estimada : existing.fecha_entrega_estimada,
      total,
      req.params.id
    );
  });
  tx();

  res.json(conItems(db.prepare('SELECT * FROM pedidos WHERE id = ?').get(req.params.id)));
});

// Cambio de estado de producción — dispara: historial (cronograma), descuento de inventario
// al pasar a en_produccion, y confirmación del ingreso en finanzas al despachar.
router.put('/:id/estado', (req, res) => {
  const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(req.params.id);
  if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
  const { estado, nota } = req.body;
  if (!ESTADOS.includes(estado)) return res.status(400).json({ error: `estado inválido, use: ${ESTADOS.join(', ')}` });

  const tx = db.transaction(() => {
    db.prepare('UPDATE pedidos SET estado_produccion = ? WHERE id = ?').run(estado, req.params.id);
    db.prepare('INSERT INTO pedido_avances (pedido_id, estado, nota) VALUES (?, ?, ?)').run(req.params.id, estado, nota || null);

    if (estado === 'en_produccion') {
      const items = db.prepare('SELECT * FROM pedido_items WHERE pedido_id = ?').all(req.params.id);
      for (const it of items) {
        if (!it.producto_id) continue;
        const receta = db.prepare('SELECT * FROM producto_materiales WHERE producto_id = ?').all(it.producto_id);
        for (const r of receta) {
          const cantidadTotal = r.cantidad_requerida * it.cantidad;
          db.prepare('UPDATE materiales SET stock_actual = stock_actual - ? WHERE id = ?').run(cantidadTotal, r.material_id);
          db.prepare(
            `INSERT INTO movimientos_inventario (material_id, tipo, cantidad, motivo) VALUES (?, 'salida', ?, ?)`
          ).run(r.material_id, cantidadTotal, `Consumo pedido ${pedido.numero}`);
        }
      }
    }

    if (estado === 'despachado') {
      db.prepare(
        `UPDATE transacciones_financieras SET estado = 'confirmado' WHERE pedido_id = ? AND tipo = 'ingreso'`
      ).run(req.params.id);

      // Registra el costo de venta (COGS) como gasto — separa la utilidad real del ingreso bruto.
      // costo_registrado evita duplicar el gasto si el pedido se vuelve a marcar despachado.
      if (!pedido.costo_registrado) {
        const items = db.prepare('SELECT * FROM pedido_items WHERE pedido_id = ?').all(req.params.id);
        let costoTotal = 0;
        for (const it of items) {
          if (!it.producto_id) continue;
          const producto = db.prepare('SELECT costo FROM productos WHERE id = ?').get(it.producto_id);
          if (producto) costoTotal += (producto.costo || 0) * it.cantidad;
        }
        if (costoTotal > 0) {
          db.prepare(
            `INSERT INTO transacciones_financieras (tipo, categoria, monto, pedido_id, estado, descripcion, fecha)
             VALUES ('gasto', 'costo_produccion', ?, ?, 'confirmado', ?, ?)`
          ).run(costoTotal, req.params.id, `Costo de venta (COGS) — pedido ${pedido.numero}`, new Date().toISOString().slice(0, 10));
        }
        db.prepare('UPDATE pedidos SET costo_registrado = 1 WHERE id = ?').run(req.params.id);
      }
    }
  });
  tx();

  res.json(conItems(db.prepare('SELECT * FROM pedidos WHERE id = ?').get(req.params.id)));
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM pedidos WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Pedido no encontrado' });
  res.json({ ok: true });
});

export default router;
