// Configuración central — todas las variables de entorno en un solo lugar.
export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  dbPath: process.env.DB_PATH || './data/geometrico-erp.db',
  panelUser: process.env.PANEL_USER || 'nestor',
  panelPassword: process.env.PANEL_PASSWORD || '',
};

if (!config.panelPassword) {
  console.warn('[config] ADVERTENCIA: PANEL_PASSWORD no está configurado — el panel queda sin protección de acceso.');
}
