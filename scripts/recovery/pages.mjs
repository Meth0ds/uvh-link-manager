import { readFileSync } from 'node:fs';

// Loaded once from the controller's immutable runtime resources.
const asset = name => readFileSync(new URL('./page-assets/' + name, import.meta.url), 'utf8');
export const css = asset('style.css');
export const maintenancePage = asset('maintenance.html');
export const adminPage = asset('admin.html');
export const maintenanceScript = asset('maintenance.js');
export const adminScript = asset('admin.js');
