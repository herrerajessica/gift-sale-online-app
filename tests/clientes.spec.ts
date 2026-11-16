import { test, expect } from '@playwright/test';
import { A, abrirTienda, entrar, irPestana, enVistaPrevia } from './support/app';

test.describe('REQ-035 Cuentas de clientes y Mis clientes', () => {
  test('CP-103 El cliente entra a Mis pedidos con un código y ve sus pedidos @REQ-035', async ({ page }) => {
    // En la página real el código llega al correo: esta prueba solo corre en la vista previa.
    test.skip(!enVistaPrevia, 'El código llega por correo; se prueba a mano en la página real');
    await abrirTienda(page, A.tienda);
    await page.locator('#cuentaBtn').click();
    await page.locator('#cuentaEmail').fill('ana@ejemplo.com');
    await page.getByRole('button', { name: 'Enviarme el código' }).click();
    const aviso = page.locator('#demoCodigo');
    await expect(aviso).toBeVisible();
    const codigo = ((await aviso.textContent()) || '').match(/\d{6}/)![0];
    // Código equivocado: avisa y no entra
    await page.locator('#cuentaCodigo').fill('000000');
    await expect(page.locator('.cuenta .err')).toBeVisible();
    await page.locator('#cuentaCodigo').fill(codigo);
    await expect(page.locator('.mi-pedido').first()).toBeVisible();
    await expect(page.locator('.mi-pedido')).toHaveCount(2);
    // La sesión se recuerda
    await page.reload();
    await expect(page.locator('#cuentaBtn')).toContainText('Ana');
  });

  test('CP-104 La vendedora ve la pestaña Clientes @REQ-035', async ({ page }) => {
    test.skip(!A.user && !enVistaPrevia, 'Define TEST_USER y TEST_PASSWORD');
    await entrar(page, A.user, A.pass);
    await irPestana(page, /Clientes/);
    await expect(page.getByRole('heading', { name: 'Mis clientes' })).toBeVisible();
    // Con clientes: lista; sin clientes: el aviso de que se arma sola
    await expect(page.locator('#clientesLista .cliente-row').first().or(page.locator('#clientesVacio'))).toBeVisible();
    if (enVistaPrevia) await expect(page.locator('#clientesLista .cliente-row').filter({ hasText: 'Ana Torres' })).toContainText('Compra seguido');
  });
});

test.describe('REQ-036 Compartir la tienda (botón y código QR)', () => {
  test('CP-106 La vendedora abre el código QR de su tienda @REQ-036', async ({ page }) => {
    test.skip(!A.user && !enVistaPrevia, 'Define TEST_USER y TEST_PASSWORD');
    await entrar(page, A.user, A.pass);
    await expect(page.getByRole('button', { name: 'Compartir mi tienda' })).toBeVisible();
    await page.getByRole('button', { name: 'Código QR' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Código QR de tu tienda' });
    await expect(dialogo).toBeVisible();
    await expect(dialogo.locator('canvas.qr-tarjeta')).toBeVisible();
    await expect(dialogo.getByRole('link', { name: 'Descargar imagen' })).toBeVisible();
    await dialogo.getByRole('button', { name: 'Cerrar' }).click();
    await expect(dialogo).toBeHidden();
  });
});
