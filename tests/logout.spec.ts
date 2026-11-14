import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';

const USER = process.env.TEST_USER ?? '';
const PASS = process.env.TEST_PASSWORD ?? '';

test.describe('REQ-002 Cierre de sesión', () => {
  test.skip(!USER || !PASS, 'Define TEST_USER y TEST_PASSWORD');

  test('CP-003 Logout @REQ-002', async ({ page }) => {
    const login = new LoginPage(page);
    await login.abrir();
    await login.login(USER, PASS);
    await expect(page.getByRole('heading', { name: 'Arrastra aquí todas las fotos' })).toBeVisible();
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page.getByRole('heading', { name: 'Tu vitrina online en minutos' })).toBeVisible();
  });
});
