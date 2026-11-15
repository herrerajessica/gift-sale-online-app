import { Page, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

// Datos de prueba (GitHub › Settings › Secrets and variables › Actions)
export const A = { user: process.env.TEST_USER ?? '', pass: process.env.TEST_PASSWORD ?? '', tienda: process.env.TEST_STORE ?? '' };
export const B = { user: process.env.TEST_USER_B ?? '', pass: process.env.TEST_PASSWORD_B ?? '', tienda: process.env.TEST_STORE_B ?? '' };

// Solo para revisar las pruebas sin internet: PREVIEW_FILE apunta a la vista previa (un solo HTML con datos
// de ejemplo). En GitHub Actions no se define y las pruebas usan la página real (BASE_URL).
const PREVIEW = process.env.PREVIEW_FILE ?? '';
export const enVistaPrevia = !!PREVIEW;

export async function abrirInicio(page: Page) {
  await page.goto(PREVIEW ? `${PREVIEW}#demo-inicio` : '/');
  await expect(page.locator('#landing')).toBeVisible();
}

export async function abrirTienda(page: Page, slug: string) {
  // En la vista previa los códigos se ponen cuando la vendedora abre su tienda (igual que en la real).
  if (PREVIEW) { await page.goto(`${PREVIEW}#demo-vendedora`); await expect(page.locator('#grid .card .cod-tag').first()).toBeVisible(); }
  await page.goto(PREVIEW ? `${PREVIEW}#demo-cliente` : `/?tienda=${encodeURIComponent(slug)}`);
  await expect(page.locator('#grid .card').first()).toBeVisible();
}

/** Entra como vendedora y espera su tienda (pestaña Productos). */
export async function entrar(page: Page, user: string, pass: string) {
  if (PREVIEW) await page.goto(`${PREVIEW}#demo-vendedora`);
  else {
    const login = new LoginPage(page);
    await login.abrir();
    await login.login(user, pass);
  }
  await expect(page.locator('#vtabs')).toBeVisible({ timeout: 20_000 });
}

export async function irPestana(page: Page, nombre: RegExp | string) {
  await page.getByRole('tab', { name: nombre }).click();
}

/** Panel de la dueña de la plataforma (la cuenta A es SUPERADMIN en pruebas). */
export async function abrirPanelDuena(page: Page, user: string, pass: string) {
  if (PREVIEW) { await page.goto(`${PREVIEW}#demo-duena`); return; }
  await entrar(page, user, pass);
  await page.getByRole('button', { name: 'Panel de dueña' }).click();
}

/** Primera tarjeta que se puede agregar al pedido. */
export const tarjetaConBoton = (page: Page) =>
  page.locator('#grid .card').filter({ has: page.getByRole('button', { name: /Agregar al pedido|Add to order/ }) }).first();
