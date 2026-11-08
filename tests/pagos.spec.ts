import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';

const USER = process.env.TEST_USER ?? '';
const PASS = process.env.TEST_PASSWORD ?? '';
// Vitrina aprobada que ya activó pagos con tarjeta (Stripe en modo de prueba).
const TIENDA_COBROS = process.env.TEST_STORE_COBROS ?? '';

test.describe('REQ-007 Planes por cantidad de productos', () => {
  test.skip(!USER || !PASS, 'Define TEST_USER y TEST_PASSWORD');

  test('CP-010 La vendedora ve su plan y cuántos productos usa @REQ-007', async ({ page }) => {
    const login = new LoginPage(page);
    await login.abrir();
    await login.login(USER, PASS);
    const plan = page.locator('#planBox');
    await expect(plan).toBeVisible();
    await expect(plan).toContainText(/Plan (Free|Básico|Pro|Plus)/);
    await expect(plan).toContainText('productos');
    await plan.getByRole('button').click();
    const dialogo = page.getByRole('dialog', { name: 'Planes' });
    for (const nombre of ['Free', 'Básico', 'Pro', 'Plus']) {
      await expect(dialogo.getByText(nombre, { exact: true })).toBeVisible();
    }
    await expect(dialogo).toContainText('Productos ilimitados');
  });
});

test.describe('REQ-008 Pago de pedidos con tarjeta', () => {
  test.skip(!TIENDA_COBROS, 'Define TEST_STORE_COBROS con una vitrina que tenga pagos con tarjeta activos');

  test('CP-013 El pedido ofrece pagar con tarjeta @REQ-008', async ({ page }) => {
    await page.goto(`/?tienda=${TIENDA_COBROS}`);
    const tarjeta = page.locator('#grid .card').filter({ has: page.getByRole('button', { name: '+ Agregar al pedido' }) })
      .filter({ has: page.locator('.price:not(.none)') }).first();
    await tarjeta.getByRole('button', { name: '+ Agregar al pedido' }).click();
    await page.locator('#cartbar').click();
    const dialogo = page.getByRole('dialog', { name: 'Mi pedido' });
    await expect(dialogo.getByRole('button', { name: 'Pagar con tarjeta' })).toBeEnabled();
    await expect(dialogo.getByRole('link', { name: 'Enviar pedido por WhatsApp' })).toBeVisible();
  });
});
