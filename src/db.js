// Persistencia SQLite del ERP — 10 tablas del diseño técnico (erp-diseno-tecnico.md).
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

mkdirSync(dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS clientes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre      TEXT NOT NULL,
  telefono    TEXT,
  email       TEXT,
  tipo        TEXT NOT NULL DEFAULT 'final',   -- final | hospitality
  ciudad      TEXT,
  notas       TEXT,
  creado_en   INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_telefono ON clientes (telefono) WHERE telefono IS NOT NULL AND telefono != '';

CREATE TABLE IF NOT EXISTS productos (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sku               TEXT,
  nombre            TEXT NOT NULL,
  variante          TEXT,
  costo             INTEGER NOT NULL DEFAULT 0,
  precio_final      INTEGER NOT NULL DEFAULT 0,
  precio_mayorista  INTEGER,
  imagen_url        TEXT,
  activo            INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS cotizaciones (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  numero          TEXT NOT NULL UNIQUE,
  cliente_id      INTEGER REFERENCES clientes(id),
  cliente_nombre  TEXT,
  cliente_telefono TEXT,
  cliente_direccion TEXT,
  modo            TEXT NOT NULL DEFAULT 'cotizacion',  -- cotizacion | orden_venta
  subtotal        INTEGER NOT NULL DEFAULT 0,
  iva_pct         REAL NOT NULL DEFAULT 0,
  iva             INTEGER NOT NULL DEFAULT 0,
  envio           INTEGER NOT NULL DEFAULT 0,
  anticipo        INTEGER NOT NULL DEFAULT 0,
  total           INTEGER NOT NULL DEFAULT 0,
  saldo           INTEGER NOT NULL DEFAULT 0,
  estado          TEXT NOT NULL DEFAULT 'borrador',   -- borrador | enviada | aceptada | rechazada
  condiciones     TEXT,     -- JSON: {produccion, pago, medios, envio}
  nota            TEXT,
  texto_garantia  TEXT,
  fecha           TEXT,
  creado_en       INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS cotizacion_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  cotizacion_id     INTEGER NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
  producto_id       INTEGER REFERENCES productos(id),
  nombre            TEXT NOT NULL,
  detalle           TEXT,
  precio_unitario   INTEGER NOT NULL,
  descuento_pct     REAL NOT NULL DEFAULT 0,
  cantidad          INTEGER NOT NULL DEFAULT 1,
  imagen_url        TEXT
);

CREATE TABLE IF NOT EXISTS pedidos (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  numero                  TEXT NOT NULL UNIQUE,
  cliente_id              INTEGER REFERENCES clientes(id),
  cliente_nombre          TEXT,
  cliente_telefono        TEXT,
  cliente_direccion       TEXT,
  cotizacion_id           INTEGER REFERENCES cotizaciones(id),
  fecha_pedido            TEXT NOT NULL,
  fecha_entrega_estimada  TEXT,
  estado_produccion       TEXT NOT NULL DEFAULT 'por_fabricar', -- por_fabricar | en_produccion | listo_despacho | despachado
  total                   INTEGER NOT NULL DEFAULT 0,
  costo_registrado        INTEGER NOT NULL DEFAULT 0,  -- 1 cuando ya se registró el costo de venta (COGS) en finanzas
  creado_en               INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS pedido_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id         INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  producto_id       INTEGER REFERENCES productos(id),
  nombre            TEXT NOT NULL,
  cantidad          INTEGER NOT NULL DEFAULT 1,
  precio_unitario   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pedido_avances (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id   INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  estado      TEXT NOT NULL,
  nota        TEXT,
  fecha       INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS materiales (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre          TEXT NOT NULL,
  unidad          TEXT NOT NULL DEFAULT 'unidad',
  stock_actual    REAL NOT NULL DEFAULT 0,
  stock_minimo    REAL NOT NULL DEFAULT 0,
  costo_unitario  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS producto_materiales (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  producto_id           INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  material_id           INTEGER NOT NULL REFERENCES materiales(id) ON DELETE CASCADE,
  cantidad_requerida    REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS movimientos_inventario (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id   INTEGER REFERENCES materiales(id),
  producto_id   INTEGER REFERENCES productos(id),
  tipo          TEXT NOT NULL,   -- entrada | salida | ajuste
  cantidad      REAL NOT NULL,
  motivo        TEXT,
  fecha         INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS transacciones_financieras (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo          TEXT NOT NULL,    -- ingreso | gasto
  categoria     TEXT NOT NULL DEFAULT 'otros',
  monto         INTEGER NOT NULL DEFAULT 0,
  pedido_id     INTEGER REFERENCES pedidos(id),
  estado        TEXT NOT NULL DEFAULT 'confirmado',  -- proyectado | confirmado
  descripcion   TEXT,
  fecha         TEXT NOT NULL,
  creado_en     INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
`);

// ── Migración: agrega columnas nuevas a bases ya desplegadas sin perder datos ──
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[db] Migración: columna ${table}.${column} agregada.`);
  }
}
ensureColumn('pedidos', 'cliente_direccion', 'TEXT');
ensureColumn('pedidos', 'costo_registrado', 'INTEGER NOT NULL DEFAULT 0');

// ── Seed de productos (catálogo del cotizador) si la tabla está vacía ──
const productCount = db.prepare('SELECT COUNT(*) AS n FROM productos').get().n;
if (productCount === 0) {
  const seed = db.prepare(`
    INSERT INTO productos (nombre, costo, precio_final, imagen_url, activo)
    VALUES (@nombre, @costo, @precio_final, @imagen_url, 1)
  `);
  const catalogo = [
    { nombre: 'Butaco Zen', precio_final: 700000, imagen_url: 'https://cdn.shopify.com/s/files/1/0790/1780/3833/files/zen-ps.jpg?v=1776382585' },
    { nombre: 'Butaco Sabina 65/75 cm', precio_final: 630000, imagen_url: 'https://cdn.shopify.com/s/files/1/0790/1780/3833/files/SabinaTBP3-1.png?v=1777587918' },
    { nombre: 'Butaco Sabina 85 cm', precio_final: 660000, imagen_url: 'https://cdn.shopify.com/s/files/1/0790/1780/3833/files/SabinaTBP3-1.png?v=1777587918' },
    { nombre: 'Silla Sabina', precio_final: 650000, imagen_url: 'https://cdn.shopify.com/s/files/1/0790/1780/3833/files/GeneratedImageOctober12_2025-3_10PM.jpg?v=1777758250' },
    { nombre: 'Butaco Sabina Artesanal', precio_final: 620000, imagen_url: 'https://cdn.shopify.com/s/files/1/0790/1780/3833/files/GeneratedImageOctober15_2025-2_57PM.jpg?v=1777758682' },
    { nombre: 'Silla Curve', precio_final: 726000, imagen_url: 'https://cdn.shopify.com/s/files/1/0790/1780/3833/files/GeneratedImageOctober12_2025-1_21PMcopia.jpg?v=1777759730' },
    { nombre: 'Silla Athena', precio_final: 640000, imagen_url: 'https://cdn.shopify.com/s/files/1/0790/1780/3833/files/GeneratedImageNovember03_2025-1_52PM_08c40128-a8b6-4466-b62e-216cb108db63.jpg?v=1777760680' },
    { nombre: 'Arhuaca Mecedora', precio_final: 630000, imagen_url: 'https://cdn.shopify.com/s/files/1/0790/1780/3833/files/Generated_Image_October_13_2025_-_9_05AM_copia.jpg?v=1777761088' },
    { nombre: 'Arhuaca Fija', precio_final: 600000, imagen_url: 'https://cdn.shopify.com/s/files/1/0790/1780/3833/files/Generated_Image_October_13_2025_-_9_05AM_copia.jpg?v=1777761088' },
    { nombre: 'Poltrona Linea', precio_final: 1770000, imagen_url: 'https://cdn.shopify.com/s/files/1/0790/1780/3833/files/GeneratedImageNovember16_2025-2_25PMcopia.jpg?v=1778526799' },
    { nombre: 'Mesa Nodo', precio_final: 490000, imagen_url: 'https://cdn.shopify.com/s/files/1/0790/1780/3833/files/IMG_1874.jpg?v=1778527759' },
    { nombre: 'Mesa Kroma Ø41x40', precio_final: 470000, imagen_url: 'https://cdn.shopify.com/s/files/1/0790/1780/3833/files/GeneratedImageOctober13_2025-11_09AMcopia.jpg?v=1778528788' },
    { nombre: 'Mesa Kroma Ø41x45', precio_final: 500000, imagen_url: 'https://cdn.shopify.com/s/files/1/0790/1780/3833/files/GeneratedImageOctober13_2025-11_09AMcopia.jpg?v=1778528788' },
    { nombre: 'Mesa Triada P Ø60', precio_final: 850000, imagen_url: 'https://cdn.shopify.com/s/files/1/0790/1780/3833/files/GeneratedImageOctober13_2025-11_48AMcopia.jpg?v=1780111322' },
    { nombre: 'Mesa Triada M Ø80', precio_final: 990000, imagen_url: 'https://cdn.shopify.com/s/files/1/0790/1780/3833/files/GeneratedImageOctober13_2025-11_48AMcopia.jpg?v=1780111322' },
    { nombre: 'Mesa Triada G Ø100', precio_final: 1190000, imagen_url: 'https://cdn.shopify.com/s/files/1/0790/1780/3833/files/GeneratedImageOctober13_2025-11_48AMcopia.jpg?v=1780111322' },
    { nombre: 'Set Duo Triada+Kroma P', precio_final: 1220000, imagen_url: 'https://cdn.shopify.com/s/files/1/0790/1780/3833/files/GeneratedImageOctober12_2025-12_06PM.jpg?v=1780111401' },
    { nombre: 'Set Duo Triada+Kroma M', precio_final: 1360000, imagen_url: 'https://cdn.shopify.com/s/files/1/0790/1780/3833/files/GeneratedImageOctober12_2025-12_06PM.jpg?v=1780111401' },
    { nombre: 'Set Duo Triada+Kroma G', precio_final: 1560000, imagen_url: 'https://cdn.shopify.com/s/files/1/0790/1780/3833/files/GeneratedImageOctober12_2025-12_06PM.jpg?v=1780111401' },
    { nombre: 'Poltrona Varese', precio_final: 2400000, imagen_url: 'https://cdn.shopify.com/s/files/1/0790/1780/3833/files/image_feebe59f-507a-471c-b06b-0c49f1898db0.png?v=1783297984' },
  ];
  const insertMany = db.transaction((rows) => {
    for (const r of rows) seed.run({ ...r, costo: 0 });
  });
  insertMany(catalogo);
  console.log(`[db] Catálogo sembrado: ${catalogo.length} productos (costo en 0 — completar en pestaña Inventario/Financiero).`);
}

export default db;
