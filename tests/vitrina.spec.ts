import { test, expect, Page } from '@playwright/test';
import { A, abrirTienda, enVistaPrevia, tarjetaConBoton } from './support/app';

const codigos = (page: Page) => page.locator('#grid .card .cod-tag').allInnerTexts();

test.describe('REQ-026 Código de cada producto', () => {
  test.skip(!A.tienda && !enVistaPrevia, 'Define TEST_STORE');

  test('CP-061 Cada producto de la tienda tiene un código y no se repite @REQ-026', async ({ page }) => {
    await abrirTienda(page, A.tienda);
    const cards = await page.locator('#grid .card').count();
    const cods = await codigos(page);
    expect(cods.length).toBe(cards);
    for (const c of cods) expect(c).toMatch(/^[A-Z]{3}-\d{3,}$/);
    expect(new Set(cods).size).toBe(cods.length);
  });

  test('CP-062 Buscar por código encuentra solo ese producto @REQ-026', async ({ page }) => {
    await abrirTienda(page, A.tienda);
    const cod = (await codigos(page))[0];
    const [pre, num] = cod.split('-');
    const buscador = page.getByRole('searchbox', { name: 'Buscar producto' });
    for (const escrito of [cod, `${pre.toLowerCase()} ${num}`, `${pre.toLowerCase()}${Number(num)}`]) {
      await buscador.fill(escrito);
      await expect(page.locator('#grid .card')).toHaveCount(1);
      await expect(page.locator('#grid .card .cod-tag')).toHaveText(cod);
    }
  });

  test('CP-063 La ficha del producto muestra su código @REQ-026', async ({ page }) => {
    await abrirTienda(page, A.tienda);
    const card = page.locator('#grid .card').first();
    const cod = await card.locator('.cod-tag').innerText();
    await card.locator('button.open').click();
    await expect(page.locator('.sheet[role="dialog"]')).toContainText(cod);
  });

  test('CP-064 El mensaje de WhatsApp del pedido lleva el código @REQ-026', async ({ page }) => {
    await abrirTienda(page, A.tienda);
    const card = tarjetaConBoton(page);
    const cod = await card.locator('.cod-tag').innerText();
    await card.getByRole('button', { name: /Agregar al pedido|Add to order/ }).click();
    await page.locator('#cartbar').click();
    const dialogo = page.getByRole('dialog', { name: /Mi pedido|My order/ });
    await expect(dialogo.locator('.preview')).toContainText(cod);
  });
});

test.describe('REQ-003 Catálogo público por vendedora', () => {
  test.skip(!A.tienda && !enVistaPrevia, 'Define TEST_STORE');

  test('CP-065 Una búsqueda sin resultados lo dice @REQ-003', async ({ page }) => {
    await abrirTienda(page, A.tienda);
    await page.getByRole('searchbox', { name: 'Buscar producto' }).fill('zzqx-no-existe');
    await expect(page.locator('#grid .card')).toHaveCount(0);
    await expect(page.locator('#emptyTitle')).toHaveText(/Nada coincide|No matches/);
  });

  test('CP-066 Un enlace de tienda que no existe lo avisa @REQ-003', async ({ page }) => {
    test.skip(enVistaPrevia, 'Solo en la página real');
    await page.goto('/?tienda=no-existe-zz-' + Date.now());
    await expect(page.locator('#emptyTitle')).toContainText('no existe');
  });
});
