import { Router } from 'express';
import db from '../db.js';
import { siguienteFolio } from '../folios.js';
import { crearPedidoDesdeCotizacion } from './pedidos.js';

const router = Router();

function conItems(cotizacion) {
  const items = db.prepare('SELECT * FROM cotizacion_items WHERE cotizacion_id = ?').all(cotizacion.id);
  return { ...cotizacion, condiciones: cotizacion.condiciones ? JSON.parse(cotizacion.condiciones) : null, items };
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM cotizaciones ORDER BY id DESC').all();
  res.json(rows.map(conItems));
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM cotizaciones WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Cotización no encontrada' });
  res.json(conItems(row));
});

// Crea cotización u orden de venta con items, calculando totales igual que el cotizador original.
router.post('/', (req, res) => {
  const {
    cliente_id, cliente_nombre, cliente_telefono, cliente_direccion,
    modo, items, iva_pct, envio, anticipo, condiciones, nota, texto_garantia, fecha,
  } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items es requerido y debe tener al menos un producto' });
  }

  const subtotal = items.reduce((sum, it) => {
    const desc = it.descuento_pct || 0;
    return sum + it.precio_unitario * it.cantidad * (1 - desc / 100);
  }, 0);
  const ivaPctNum = iva_pct || 0;
  const iva = Math.round(subtotal * (ivaPctNum / 100));
  const envioNum = envio || 0;
  const total = Math.round(subtotal + iva + envioNum);
  const anticipoNum = modo === 'orden_venta' ? (anticipo || 0) : 0;
  const saldo = Math.max(0, total - anticipoNum);

  const prefijo = modo === 'orden_venta' ? 'ORD' : 'COT';
  const numero = siguienteFolio(prefijo, 'cotizaciones');

  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO cotizaciones
         (numero, cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, modo,
          subtotal, iva_pct, iva, envio, anticipo, total, saldo, estado, condiciones, nota, texto_garantia, fecha)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'borrador', ?, ?, ?, ?)`
      )
      .run(
        numero,
        cliente_id || null,
        cliente_nombre || null,
        cliente_telefono || null,
        cliente_direccion || null,
        modo || 'cotizacion',
        Math.round(subtotal),
        ivaPctNum,
        iva,
        envioNum,
        anticipoNum,
        total,
        saldo,
        condiciones ? JSON.stringify(condiciones) : null,
        nota || null,
        texto_garantia || null,
        fecha || new Date().toISOString().slice(0, 10)
      );
    const cotId = info.lastInsertRowid;
    const insertItem = db.prepare(
      `INSERT INTO cotizacion_items (cotizacion_id, producto_id, nombre, detalle, precio_unitario, descuento_pct, cantidad, imagen_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const it of items) {
      insertItem.run(
        cotId,
        it.producto_id || null,
        it.nombre,
        it.detalle || null,
        it.precio_unitario,
        it.descuento_pct || 0,
        it.cantidad,
        it.imagen_url || null
      );
    }
    return cotId;
  });

  const cotId = tx();
  res.status(201).json(conItems(db.prepare('SELECT * FROM cotizaciones WHERE id = ?').get(cotId)));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM cotizaciones WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Cotización no encontrada' });
  const { estado, nota } = req.body;
  if (estado) db.prepare('UPDATE cotizaciones SET estado = ? WHERE id = ?').run(estado, req.params.id);
  if (nota !== undefined) db.prepare('UPDATE cotizaciones SET nota = ? WHERE id = ?').run(nota, req.params.id);
  res.json(conItems(db.prepare('SELECT * FROM cotizaciones WHERE id = ?').get(req.params.id)));
});

// Aceptar cotización → crea pedido automáticamente (sin doble digitación)
router.post('/:id/aceptar', (req, res) => {
  const cot = db.prepare('SELECT * FROM cotizaciones WHERE id = ?').get(req.params.id);
  if (!cot) return res.status(404).json({ error: 'Cotización no encontrada' });
  if (cot.estado === 'aceptada') return res.status(400).json({ error: 'Esta cotización ya fue aceptada' });

  const { fecha_entrega_estimada } = req.body;
  const items = db.prepare('SELECT * FROM cotizacion_items WHERE cotizacion_id = ?').all(cot.id);

  const pedido = crearPedidoDesdeCotizacion(cot, items, fecha_entrega_estimada);
  db.prepare("UPDATE cotizaciones SET estado = 'aceptada' WHERE id = ?").run(cot.id);

  res.status(201).json({ cotizacion: conItems(db.prepare('SELECT * FROM cotizaciones WHERE id = ?').get(cot.id)), pedido });
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM cotizaciones WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Cotización no encontrada' });
  res.json({ ok: true });
});

export default router;
