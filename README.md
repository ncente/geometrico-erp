# Geometrico · Sistema de Control Integral (ERP ligero)

Panel único con 5 módulos conectados — clientes/pedidos, cotizador, producción, cronograma, inventario y financiero — construido sobre el diseño de `output/erp-diseno-tecnico.md`. Reemplaza hojas sueltas y el cotizador aislado (`geometrico-cotizador_10.html`, absorbido en el módulo Cotizador · Pedidos).

## Qué hace

- **Clientes y pedidos:** registro de cliente, productos, fechas, estado.
- **Cotizador · Pedidos:** misma lógica del cotizador original (tiers público/hospitality/proyecto, descuento por ítem, IVA, envío, anticipo solo en orden de venta) pero contra base de datos real. Aceptar una cotización crea el pedido automáticamente — sin doble digitación.
- **Producción:** tablero kanban por_fabricar → en_produccion → listo_despacho → despachado, con historial de avances.
- **Cronograma:** pedidos activos ordenados por fecha de entrega, con bandera de atraso.
- **Inventario:** materiales con stock mínimo y alertas; al pasar un pedido a "en producción" descuenta automáticamente los materiales según la receta (`producto_materiales`) definida por producto.
- **Financiero:** cada pedido genera un ingreso proyectado al crearse y se confirma al despacharse; margen por producto calculado sobre pedidos despachados; salud de caja = ingresos confirmados − gastos.

Ver `output/erp-diseno-tecnico.md` para el modelo de datos completo (10 tablas) y los endpoints REST.

## Acceso

El panel entero (frontend + API) está protegido con autenticación básica de un solo usuario (`PANEL_USER` / `PANEL_PASSWORD`). El navegador pedirá usuario y clave la primera vez — quedan guardados por el navegador, funciona igual en celular y computador.

## Estructura

```
src/
  server.js          Express: auth básica + API + sirve el panel estático
  config.js           Variables de entorno
  db.js                SQLite: 10 tablas + seed del catálogo de productos
  folios.js            Folios consecutivos COT/ORD/PED-2026-0001
  routes/
    clientes.js
    productos.js        incluye receta de materiales por producto
    materiales.js        inventario + movimientos
    cotizaciones.js      cotización/orden de venta + aceptar → crea pedido
    pedidos.js            CRUD + cambio de estado (dispara inventario y finanzas)
    finanzas.js            transacciones + resumen
  public/
    index.html          panel SPA (vanilla JS, sin build step), identidad Geometrico
```

## Correr en local

```bash
cd geometrico-erp
npm install
cp .env.example .env   # define PANEL_PASSWORD
npm start
```

Abre `http://localhost:3000`.

## Deploy en Railway (mismo proyecto del agente de WhatsApp)

Se decidió (ver `output/erp-diseno-tecnico.md`, sección 1) crear un **servicio nuevo dentro del mismo proyecto Railway** donde ya corre `geometrico-agente-whatsapp` — así se evita aprobar un plan nuevo; el costo adicional es solo el uso marginal de este segundo servicio.

### 1. Subir a GitHub

```bash
cd geometrico-erp
git init
git add .
git commit -m "Sistema de Control Integral — Geometrico"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/geometrico-erp.git
git push -u origin main
```

### 2. Crear el servicio en Railway

1. Entra al proyecto Railway donde ya vive `geometrico-agente-whatsapp`.
2. **New → GitHub Repo** → selecciona `geometrico-erp`.
3. Railway detecta Node.js automáticamente (usa `npm start`).

### 3. Variables de entorno del nuevo servicio

| Variable | Valor |
|---|---|
| `PORT` | Railway la inyecta sola — no la definas a mano |
| `DB_PATH` | `/data-erp/geometrico-erp.db` |
| `PANEL_USER` | `nestor` (o el que prefieras) |
| `PANEL_PASSWORD` | una clave fuerte — este panel va a producción real |

### 4. Volumen persistente (independiente del agente de WhatsApp)

En el servicio nuevo: **Settings → Volumes → New Volume** → móntalo en `/data-erp`. Esto evita que este servicio comparta o pise el volumen `/data` del agente de WhatsApp.

### 5. Dominio público

**Settings → Networking → Generate Domain**. Con eso ya tienes acceso desde celular y computador al mismo panel y misma base de datos, en tiempo real.

### 6. Verificar

- `https://tu-dominio.up.railway.app/health` → `{"ok":true}` (sin auth).
- Abrir la URL raíz → el navegador debe pedir usuario/clave → tras ingresar, ver el panel con el catálogo de 20 productos ya sembrado.
- Probar desde el celular con la misma URL y las mismas credenciales — debe ver los mismos datos que en el computador (misma base SQLite en el volumen).

## Nota sobre `better-sqlite3`

Este proyecto usa `better-sqlite3` (igual que `geometrico-agente-whatsapp`, ya probado en producción). Requiere compilar un módulo nativo durante `npm install` — Railway lo hace automáticamente en su entorno de build con acceso completo a internet. La lógica de todas las rutas y del flujo cotización → pedido → inventario → finanzas ya fue probada de extremo a extremo antes de esta entrega.

## Completar antes de operar a diario

1. **Costos de productos:** el catálogo se sembró con costo en `0` (el cotizador original no traía costos). Editar cada producto en la base — o pedir que se agregue una pestaña de edición de catálogo — antes de confiar en el margen por producto.
2. **Receta de materiales:** para que el descuento automático de inventario funcione, cada producto necesita su receta cargada vía `POST /api/productos/:id/materiales`. Sin receta, el pedido avanza de estado igual, simplemente no descuenta nada (no rompe el flujo).
3. **`PANEL_PASSWORD`:** defínela antes de exponer el dominio público — sin ella el panel queda abierto a cualquiera con el link.
