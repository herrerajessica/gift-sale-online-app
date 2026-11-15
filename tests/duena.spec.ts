import { test, expect } from '@playwright/test';
import { A, abrirPanelDuena, enVistaPrevia } from './support/app';

test.describe('REQ-006 Aprobación de vitrinas', () => {
  test.skip(!enVistaPrevia && (!A.user || !A.pass), 'Define TEST_USER (SUPERADMIN en pruebas)');

  test('CP-079 La dueña ve el panel con las vitrinas y sin las pestañas de su tienda @REQ-006', async ({ page }) => {
    await abrirPanelDuena(page, A.user, A.pass);
    await expect(page.getByRole('heading', { name: 'Panel de la dueña' })).toBeVisible({ timeout: 20_000 });
    for (const f of ['Pendientes', 'Aprobadas', 'Suspendidas', 'Todas']) await expect(page.locator('#panelFilter').getByRole('button', { name: new RegExp(f) })).toBeVisible();
    await page.locator('#panelFilter').getByRole('button', { name: /Todas/ }).click();
    await expect(page.locator('#panelRows tr').first()).toBeVisible();
    await expect(page.locator('#vtabs')).toBeHidden();
    await expect(page.locator('#planBox')).toBeHidden();
  });
});
