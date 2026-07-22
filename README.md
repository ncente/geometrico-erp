# Geometrico · Sistema de Control Integral (ERP ligero)

Panel único con 5 módulos conectados — clientes/pedidos, cotizador, producción, cronograma, inventario y financiero — construido sobre el diseño de `output/erp-diseno-tecnico.md`. Reemplaza hojas sueltas y el cotizador aislado (`geometrico-cotizador.html`, absorbido en el módulo Cotizador · Pedidos).

## Qué hace

- **Clientes y pedidos:** registro de cliente, productos, fechas, estado. Editable en cualquier momento — el nombre, teléfono y dirección de un cliente se pueden completar o corregir después de creada la cotización, la orden o el pedido (muchos clientes solo confirman la dirección exacta cuando ya se va a despachar).
- **Cotizador · Pedidos:** misma lógica del cotizador original (tiers público/hospitality/proyecto, descuento por ítem, IVA, envío, anticipo solo en orden de venta) pero contra base de datos real. Aceptar una cotización crea el pedido automáticamente — sin doble digitación.
- **Producción:** tablero kanban por_fabricar → en_produccion → listo_despacho → despachado, con historial de avances.
- **Cronograma:** pedidos activos ordenados por fecha de entrega, con bandera de atraso.
- **Inventario:** materiales con stock mínimo y alertas; al pasar un pedido a "en producción" descuenta automáticamente los materiales según la receta (`producto_materiales`) definida por producto.
- **Financiero:** separa el **ingreso bruto** (lo que paga el cliente, incluye tu margen) de la **utilidad real**. Al despachar un pedido se registra automáticamente el costo de venta (COGS) según el costo del producto — así "salud de caja" y "utilidad neta" reflejan lo que de verdad ganaste, no solo lo que facturaste. Incluye tendencia mensual de los últimos 6 meses y margen por producto.
- **Generar PDF:** cada cotización u orden de venta se puede reimprimir en cualquier momento (botón "Generar PDF") como documento de marca listo para compartir con el cliente — encabezado con logo real (`src/public/logo.png`), detalle de productos, totales, condiciones, garantía y ficha de referencia.

Ver `output/erp-diseno-tecnico.md` para el modelo de datos completo y los endpoints REST.

## Cómo funciona ahora el dinero (importante)

Antes, cada pedido registraba como "ingreso" el valor total de venta, y no había ningún registro automático de cuánto costó producir esa venta — así que "salud de caja" mezclaba ingreso bruto con utilidad, y sobreestimaba cuánto quedaba realmente disponible.

Ahora:

1. Al **crear** un pedido, se registra un ingreso **proyectado** por el valor total de venta (dinero que va a entrar, aún no confirmado).
2. Al **despachar**, ese ingreso pasa a **confirmado** (dinero que ya entró) y, en el mismo momento, se registra automáticamente un **gasto de categoría `costo_produccion`** (COGS) igual al costo real de los productos vendidos.
3. El resumen financiero ahora muestra: ingresos confirmados, costo de venta, utilidad bruta (ingresos − costo de venta), gastos operativos (todo lo demás: nómina, marketing, arriendo — lo que registras manualmente), utilidad neta, y salud de caja (ingresos confirmados − todos los gastos).

Esto solo funciona bien si el **costo de cada producto está actualizado** en la pestaña de catálogo — si un producto tiene costo en 0, su "costo de venta" también será 0 y la utilidad se verá inflada.

## Acceso

El panel entero (frontend + API) está protegido con autenticación básica de un solo usuario (`PANEL_USER` / `PANEL_PASSWORD`). El navegador pedirá usuario y clave la primera vez — quedan guardados por el navegador, funciona igual en celular y computador.

## Estructura

```
src/
  server.js          Express: auth básica + API + sirve el panel estático
  config.js           Variables de entorno
  db.js                SQLite: 10 tablas + seed del catálogo + migraciones automáticas de esquema
  folios.js            Folios consecutivos COT/ORD/PED-2026-0001
  routes/
    clientes.js
    productos.js        incluye receta de materiales por producto
    materiales.js        inventario + movimientos
    cotizaciones.js      cotización/orden de venta + editar (cualquier estado) + aceptar → crea pedido
    pedidos.js            CRUD + editar cliente/items (cualquier estado) + cambio de estado (dispara inventario, COGS y finanzas)
    finanzas.js            transacciones + resumen (ingreso vs. utilidad, tendencia mensual)
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

## Desplegar cambios (el servicio ya existe en Railway)

Como el servicio `geometrico-erp` ya está conectado a este repo de GitHub, cualquier actualización se despliega sola:

```bash
cd geometrico-erp
git add .
git commit -m "Editar cotizaciones/pedidos + separar ingreso de utilidad en finanzas"
git push
```

Railway detecta el push a `main` y redeploya automáticamente — no hay que tocar nada en Railway. Las migraciones de columnas nuevas (`cliente_direccion`, `costo_registrado`) se aplican solas al arrancar, sin perder los datos que ya tengas cargados.

## Deploy inicial en Railway (referencia, ya ejecutado)

Se decidió (ver `output/erp-diseno-tecnico.md`, sección 1) crear un servicio nuevo dentro del mismo proyecto Railway donde ya corre `geometrico-agente-whatsapp`, con volumen propio en `/data-erp` y las variables `DB_PATH`, `PANEL_USER`, `PANEL_PASSWORD`. Esto ya está hecho — esta sección queda como referencia si algún día hay que recrear el servicio desde cero.

## Nota sobre `better-sqlite3`

Este proyecto usa `better-sqlite3` (igual que `geometrico-agente-whatsapp`, ya probado en producción). Requiere compilar un módulo nativo durante `npm install` — Railway lo hace automáticamente en su entorno de build con acceso completo a internet.

## Completar antes de confiar 100% en el módulo financiero

1. **Costos de productos:** revisa que cada producto activo tenga su costo real cargado — sin esto, el costo de venta automático (COGS) queda en 0 y la utilidad se ve inflada.
2. **Receta de materiales:** para que el descuento automático de inventario funcione, cada producto necesita su receta cargada vía `POST /api/productos/:id/materiales`.
3. **Gastos operativos:** regístralos en la pestaña Financiero (nómina, marketing, arriendo, envíos que tú pagas, etc.) — el sistema no los inventa, solo automatiza el costo de venta.

---

## Plan estratégico: cómo sacarle más partido a este ERP

Esto es la base operativa (Fase 1-5 del brief original) ya funcionando. Lo que sigue es una hoja de ruta de qué construir después, en orden de impacto esperado sobre las dos métricas que más importan hoy: subir de 7-13 a 40 unidades/mes de capacidad, y saber con certeza cuánta plata queda al final del mes.

### 1. Cerrar el círculo con el agente de WhatsApp (impacto alto, esfuerzo medio)

Hoy el agente de WhatsApp califica y hace *handoff* a ti, pero la cotización y el pedido se siguen creando a mano en el ERP. El siguiente paso natural es que, cuando tú confirmes una venta por WhatsApp con el comando `/venta`, el agente llame automáticamente al ERP (`POST /api/pedidos`) en vez de (o además de) disparar el evento CAPI. Esto elimina la última doble digitación que queda en todo el flujo: lead → conversación → venta → pedido, sin que nadie escriba el pedido dos veces.

### 2. Pronóstico de caja a 30/60/90 días (impacto alto, esfuerzo bajo)

Ya tienes los datos: pedidos con `fecha_entrega_estimada` y su ingreso proyectado, anticipos ya cobrados, saldo pendiente por cobrar. Con eso se puede construir una vista simple que responda "¿cuánta plata voy a tener en caja dentro de 30 días si nada cambia?" — muy valioso para decidir cuándo comprar materia prima en volumen o cuándo puedes permitirte gastar en pauta.

### 3. Punto de equilibrio y meta mensual (impacto alto, esfuerzo bajo)

Con costo de producto ya separado de gasto operativo, calcular cuántas unidades del mix actual necesitas vender al mes para cubrir tus gastos fijos (nómina, arriendo, etc.) es una consulta directa sobre datos que ya existen. Esto convierte "vender más" en un número concreto y no en una sensación.

### 4. Alertas proactivas por WhatsApp (impacto medio, esfuerzo bajo)

El servidor del ERP y el del agente de WhatsApp ya viven en el mismo proyecto Railway — se pueden comunicar entre sí. Ideas de alto valor con poco esfuerzo: aviso automático cuando un material cae bajo el mínimo, cuando un pedido se atrasa según el cronograma, o un resumen semanal de caja los lunes — todo llegando a tu WhatsApp sin que tengas que entrar al panel a revisar.

### 5. Analítica de qué se vende y a quién (impacto medio, esfuerzo medio)

Con clientes tipados (`final` vs `hospitality`) y margen por producto ya calculado, el siguiente nivel es cruzar ambos: qué productos son más rentables por segmento de cliente, y qué tan seguido repite compra un cliente hospitality (que suelen ser cuentas de mayor volumen). Esto informa directamente las decisiones de precio y de a quién dirigir la pauta de Meta Ads.

### 6. Vincular Shopify como fuente única de catálogo (impacto medio, esfuerzo medio)

Ahora mismo el catálogo del ERP vive por separado del de Shopify (se sembró desde el cotizador). El riesgo es que un cambio de precio en Shopify no se refleje aquí, o viceversa. Ya tienes el conector de Shopify disponible — sincronizar precios y SKUs en una sola dirección (Shopify → ERP, de solo lectura) evita mantener dos catálogos a mano.

### 7. Reporte mensual automático para ti (impacto medio, esfuerzo bajo)

Con la tendencia mensual que ya se calcula en Financiero, un cierre de mes automático (ingresos, costo de venta, utilidad neta, top 3 productos, pedidos atrasados) que se genere solo el día 1 de cada mes ahorra la tarea manual de revisar y te da un punto fijo de referencia para decisiones trimestrales.

**Sugerencia de orden:** 2 y 3 son las de mayor impacto con menor esfuerzo — dan visibilidad financiera real esta semana. 1 y 4 eliminan trabajo manual diario. 5, 6 y 7 son de más fondo y tienen sentido una vez el negocio esté vendiendo más cerca de las 40 unidades/mes de capacidad.
