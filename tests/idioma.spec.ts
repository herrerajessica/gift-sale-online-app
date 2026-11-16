import { test, expect } from '@playwright/test';
import { A, abrirTienda, enVistaPrevia } from './support/app';

test.describe('REQ-034 Tienda en dos idiomas (ES | EN)', () => {
  test.skip(!A.tienda && !enVistaPrevia, 'Define TEST_STORE');

  test('CP-101 El cliente cambia la tienda a inglés y vuelve a español @REQ-034', async ({ page }) => {
    await abrirTienda(page, A.tienda);
    const btn = page.locator('#langBtn');
    await expect(btn).toBeVisible();
    // La tienda de prueba es de Perú: empieza en español
    await expect(btn).toHaveText('English');
    await expect(page.locator('#q')).toHaveAttribute('placeholder', 'Buscar producto…');
    await btn.click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(btn).toHaveText('Español');
    await expect(page.locator('#q')).toHaveAttribute('placeholder', 'Search products…');
    await expect(page.getByRole('button', { name: 'All', exact: true })).toBeVisible();   // filtro de categorías en inglés
    // Se recuerda al volver a entrar
    await page.reload();
    await expect(page.locator('#langBtn')).toHaveText('Español');
    await expect(page.locator('#q')).toHaveAttribute('placeholder', 'Search products…');
    await page.locator('#langBtn').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.locator('#q')).toHaveAttribute('placeholder', 'Buscar producto…');
  });
});
