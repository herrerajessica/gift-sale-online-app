import { test, expect } from '@playwright/test';

// Vitrina aprobada que configuró su número o QR de Yape y tiene tipo de cambio.
const TIENDA_YAPE = process.env.TEST_STORE_YAPE ?? '';

test.describe('REQ-009 Pago con Yape (QR)', () => {
  test.skip(!TIENDA_YAPE, 'Define TEST_STORE_YAPE con una vitrina que tenga Yape configurado');

  test('CP-016 El cliente ve el QR, el número y el monto en soles @REQ-009', async ({ page }) => {
    await page.goto(`/?tienda=${TIENDA_YAPE}`);
    const tarjeta = page.locator('#grid .card').filter({ has: page.getByRole('button', { name: '+ Agregar al pedido' }) })
      .filter({ has: page.locator('.price:not(.none)') }).first();
    await tarjeta.getByRole('button', { name: '+ Agregar al pedido' }).click();
    await page.locator('#cartbar').click();
    await page.getByRole('button', { name: 'Pagar con Yape' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Mi pedido' });
    await expect(dialogo.getByRole('heading', { name: 'Pagar con Yape' })).toBeVisible();
    await expect(dialogo.locator('.yape-pay .monto')).toHaveText(/^S\/ \d/);
  });

  test('CP-017 El nombre es obligatorio para enviar el pedido @REQ-009', async ({ page }) => {
    await page.goto(`/?tienda=${TIENDA_YAPE}`);
    const tarjeta = page.locator('#grid .card').filter({ has: page.getByRole('button', { name: '+ Agregar al pedido' }) })
      .filter({ has: page.locator('.price:not(.none)') }).first();
    await tarjeta.getByRole('button', { name: '+ Agregar al pedido' }).click();
    await page.locator('#cartbar').click();
    await page.getByRole('button', { name: 'Pagar con Yape' }).click();
    await page.getByLabel('Tu nombre').fill('');
    await page.getByRole('button', { name: 'Ya pagué, enviar pedido' }).click();
    await expect(page.getByRole('alert')).toContainText('Escribe tu nombre');
  });
});
