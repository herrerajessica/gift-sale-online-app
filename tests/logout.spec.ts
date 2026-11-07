import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';

test.describe('REQ-002 Cierre de sesión', () => {
  test('CP-003 Logout @REQ-002', async ({ page }) => {
    const login = new LoginPage(page);
    await login.abrir();
    await login.login(process.env.TEST_USER ?? '', process.env.TEST_PASSWORD ?? '');
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page).toHaveURL(/login/);
  });
});
