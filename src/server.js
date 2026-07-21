// Servidor del Sistema de Control Integral (ERP ligero) de Geometrico.
// Panel único (SPA estática) + API REST sobre SQLite. Ver output/erp-diseno-tecnico.md.
import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';

import clientesRouter from './routes/clientes.js';
import productosRouter from './routes/productos.js';
import materialesRouter from './routes/materiales.js';
import cotizacionesRouter from './routes/cotizaciones.js';
import pedidosRouter from './routes/pedidos.js';
import finanzasRouter from './routes/finanzas.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '15mb' })); // límite alto: el cotizador adjunta imágenes en base64

// ── Salud (sin auth — usado por Railway healthcheck) ──
app.get('/health', (_req, res) => res.json({ ok: true }));

// ── Auth básica: un solo usuario (Nestor), protege panel + API ──
function auth(req, res, next) {
  if (!config.panelPassword) return next(); // sin password configurado: acceso abierto (advertido en boot)
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
    const userOk = user === config.panelUser;
    const passBuf = Buffer.from(pass || '');
    const expectedBuf = Buffer.from(config.panelPassword);
    const passOk = passBuf.length === expectedBuf.length && timingSafeEqual(passBuf, expectedBuf);
    if (userOk && passOk) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Geometrico ERP"');
  return res.status(401).send('Autenticación requerida');
}
app.use(auth);

// ── API ──
app.use('/api/clientes', clientesRouter);
app.use('/api/productos', productosRouter);
app.use('/api/materiales', materialesRouter);
app.use('/api/cotizaciones', cotizacionesRouter);
app.use('/api/pedidos', pedidosRouter);
app.use('/api/finanzas', finanzasRouter);
app.get('/api/salud', (_req, res) => res.json({ ok: true }));

// ── Panel (SPA estática) ──
app.use(express.static(join(__dirname, 'public')));
app.get('*', (_req, res) => res.sendFile(join(__dirname, 'public', 'index.html')));

app.listen(config.port, () => {
  console.log(`[server] Geometrico ERP escuchando en :${config.port}`);
});
