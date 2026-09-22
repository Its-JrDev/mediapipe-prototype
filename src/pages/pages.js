/** Ids de página compartidos (navegación por evento 'ui:navigate'). */
export const APP_PAGES = Object.freeze({
  HOME: 'home',
  STUDIO: 'studio',
  INFO: 'info',
});

export const PAGE_META = Object.freeze([
  { id: APP_PAGES.HOME, label: 'Inicio', icon: '🏠' },
  { id: APP_PAGES.STUDIO, label: 'Estudio', icon: '🎚️' },
  { id: APP_PAGES.INFO, label: 'Info', icon: 'ℹ️' },
]);
