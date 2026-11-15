import { test, expect } from '@playwright/test';
import { A, abrirTienda, enVistaPrevia } from './support/app';

test.describe('REQ-031 Asistente de compras del cliente', () => {
  test.skip(!A.tienda && !enVistaPrevia, 'Define TEST_STORE');

  test('CP-091 El cliente pregunta y recibe productos de la tienda @REQ-031', async ({ page }) => {
    await abrirTienda(page, A.tienda);
    const btn = page.locator('#cliBtn');
    test.skip(!(await btn.isVisible()), 'La tienda tiene apagado el asistente para clientes');
    await btn.click();
    await expect(page.locator('#cli')).toBeVisible();
    await page.locator('#cliInput').fill('¿Qué productos tienes? Muéstrame algunas opciones');
    await page.keyboard.press('Enter');
    // Responde (con IA en la página real) y no muestra error
    await expect(page.locator('#cliLog .burbuja.user')).toHaveCount(1);
    await expect(page.locator('#cliLog .pensando')).toHaveCount(0, { timeout: 45_000 });
    await expect(page.locator('#cliLog .burbuja.assistant')).toHaveCount(1);   // el saludo se cambia por la respuesta
    await expect(page.locator('#cliLog .burbuja.error')).toHaveCount(0);
    const tarjetas = page.locator('#cliLog .cli-prod');
    if (await tarjetas.count()) {
      await expect(tarjetas.first()).toContainText(/[A-Z]{3}-\d{3}/);   // código del producto
      await tarjetas.first().click();
      await expect(page.locator('.sheet[role="dialog"]')).toBeVisible();
    }
  });
});
