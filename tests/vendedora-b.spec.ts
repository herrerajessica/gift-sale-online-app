import { test, expect } from '@playwright/test';
import { B, entrar, abrirTienda, enVistaPrevia } from './support/app';

test.describe('REQ-022 Segunda vendedora (tiendas de confianza)', () => {
  test.skip(enVistaPrevia || !B.user || !B.pass || !B.tienda, 'Define TEST_USER_B, TEST_PASSWORD_B y TEST_STORE_B');

  test('CP-080 La vendedora B entra a su propia tienda @REQ-022', async ({ page }) => {
    await entrar(page, B.user, B.pass);
    await expect(page.locator('#storeBanner')).toContainText(B.tienda);
    await expect(page.locator('#confBox')).toBeHidden();               // está en su pestaña
  });

  test('CP-081 La tienda de B se ve en soles para sus clientes @REQ-022', async ({ page }) => {
    await abrirTienda(page, B.tienda);
    const precio = page.locator('#grid .card .price:not(.none)').first();
    test.skip((await precio.count()) === 0, 'La tienda B no tiene productos con precio');
    await expect(precio).toContainText('S/');
  });
});
