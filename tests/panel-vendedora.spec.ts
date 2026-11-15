import { test, expect } from '@playwright/test';
import { A, entrar, irPestana, enVistaPrevia } from './support/app';

const PESTANAS = ['Productos', 'Pedidos', 'Tiendas de confianza', 'Plan y cobros', 'Datos de la tienda'];

test.describe('REQ-027 Panel de la vendedora por pestañas', () => {
  test.skip(!enVistaPrevia && (!A.user || !A.pass), 'Define TEST_USER y TEST_PASSWORD');
  test.beforeEach(async ({ page }) => { await entrar(page, A.user, A.pass); });

  test('CP-067 Se ven las 5 pestañas y abre en Productos @REQ-027', async ({ page }) => {
    for (const n of PESTANAS) await expect(page.getByRole('tab', { name: new RegExp(n) })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Productos/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: /Cómo quieres subir tus productos/ })).toBeVisible();
    await expect(page.locator('#storeBanner')).toBeVisible();
  });

  test('CP-068 Cada pestaña muestra solo lo suyo @REQ-027', async ({ page }) => {
    const subir = page.getByRole('heading', { name: /Cómo quieres subir tus productos/ });
    await irPestana(page, /Pedidos/);
    await expect(page.locator('#pedidosBox, #pedidosVacio').filter({ visible: true })).toHaveCount(1);
    await expect(subir).toBeHidden();
    await irPestana(page, /Tiendas de confianza/);
    await expect(page.locator('#confBox')).toBeVisible();
    await irPestana(page, /Plan y cobros/);
    await expect(page.locator('#planBox')).toBeVisible();
    await expect(page.locator('#confBox')).toBeHidden();
    await irPestana(page, /Datos de la tienda/);
    await expect(page.getByLabel('Nombre de la tienda')).toBeVisible();
    await expect(page.locator('#planBox')).toBeHidden();
    await irPestana(page, /Productos/);
    await expect(subir).toBeVisible();
    await expect(page.locator('#storeBanner')).toBeVisible();          // el enlace queda arriba en todas
  });

  test('CP-069 Recuerda la última pestaña al volver @REQ-027', async ({ page }) => {
    await irPestana(page, /Plan y cobros/);
    await page.reload();
    await expect(page.getByRole('tab', { name: /Plan y cobros/ })).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 });
    await expect(page.locator('#planBox')).toBeVisible();
  });

  test('CP-070 El numerito de Productos coincide con los productos @REQ-027', async ({ page }) => {
    await expect(page.locator('#grid .card').first()).toBeVisible();
    const n = await page.locator('#grid .card').count();
    await expect(page.locator('#vtN-productos')).toHaveText(String(n));
  });

  test('CP-071 Todos los productos de la vendedora tienen código distinto @REQ-026', async ({ page }) => {
    await expect(page.locator('#grid .card').first()).toBeVisible();
    await expect.poll(async () => (await page.locator('#grid .card .cod-tag').count()) === (await page.locator('#grid .card').count()), { timeout: 30_000 }).toBe(true);
    const cods = await page.locator('#grid .card .cod-tag').allInnerTexts();
    expect(new Set(cods).size).toBe(cods.length);
  });

  test('CP-072 Al editar un producto se ve su código @REQ-026', async ({ page }) => {
    const card = page.locator('#grid .card').filter({ has: page.locator('.cod-tag') }).first();
    const cod = await card.locator('.cod-tag').innerText();
    await card.locator('button.open').click();
    const ficha = page.locator('.sheet[role="dialog"]');
    await expect(ficha).toContainText('Código ' + cod);
    await expect(ficha.getByLabel('Nombre', { exact: true })).toBeVisible();
  });

  test('CP-073 Editar varios: marcar todos y salir @REQ-027', async ({ page }) => {
    await page.locator('#selectBtn').click();
    await expect(page.locator('#bulk')).toBeVisible();
    await page.locator('#bulkAll').click();
    const n = await page.locator('#grid .card').count();
    await expect(page.locator('#bulkCount')).toContainText(String(n));
    await page.locator('#bulkDone').click();
    await expect(page.locator('#bulk')).toBeHidden();
  });

  test('CP-074 Dictar productos abre su ventana @REQ-023', async ({ page }) => {
    await page.locator('#dictBtn').click();
    await expect(page.locator('#planOverlay [role="dialog"]')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('CP-075 El asistente se abre y se cierra @REQ-027', async ({ page }) => {
    await page.locator('#asisBtn').click();
    await expect(page.locator('#asis')).toBeVisible();
    await expect(page.locator('#asisInput')).toBeVisible();
    await page.locator('#asisCerrar').click();
    await expect(page.locator('#asis')).toBeHidden();
  });

  test('CP-076 Tiendas de confianza abre su ventana con pestañas @REQ-022', async ({ page }) => {
    await irPestana(page, /Tiendas de confianza/);
    await page.locator('#confBtn').click();
    const dlg = page.getByRole('dialog', { name: 'Tiendas de confianza' });
    await expect(dlg).toBeVisible();
    for (const t of ['Tiendas', 'Para revender', 'Cuentas']) await expect(dlg.getByRole('button', { name: new RegExp('^' + t) })).toBeVisible();
  });

  test('CP-077 Datos de la tienda trae los datos guardados @REQ-027', async ({ page }) => {
    await irPestana(page, /Datos de la tienda/);
    await expect(page.getByLabel('Nombre de la tienda')).not.toHaveValue('');
    await expect(page.getByRole('button', { name: 'Guardar', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cambiar contraseña' })).toBeVisible();
  });

  test('CP-078 El plan se ve en Plan y cobros con el botón de planes @REQ-007', async ({ page }) => {
    await irPestana(page, /Plan y cobros/);
    const plan = page.locator('#planBox');
    await expect(plan).toContainText(/Plan (Free|Básico|Pro|Plus)/);
    await plan.getByRole('button').click();
    await expect(page.getByRole('dialog', { name: 'Planes' })).toBeVisible();
  });

  test('CP-094 Al editar un producto se elige su tipo y la categoría se pone sola @REQ-032', async ({ page }) => {
    await page.locator('#grid .card button.open').first().click();
    const tipo = page.locator('#eTipo');
    await expect(tipo).toBeVisible();
    await tipo.selectOption('Falda');
    await expect(page.locator('#eCat')).toHaveValue('Ropa');
    await page.keyboard.press('Escape');   // no se guarda nada
  });
});
