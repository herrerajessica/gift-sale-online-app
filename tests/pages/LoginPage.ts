import { Page, Locator } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly usuario: Locator;
  readonly contrasena: Locator;
  readonly botonIngresar: Locator;
  readonly mensajeError: Locator;

  constructor(page: Page) {
    this.page = page;
    this.usuario = page.getByLabel('Usuario');
    this.contrasena = page.getByLabel('Contraseña');
    this.botonIngresar = page.getByRole('button', { name: 'Ingresar' });
    this.mensajeError = page.getByRole('alert');
  }

  async abrir() {
    await this.page.goto('/login');
  }

  async login(usuario: string, contrasena: string) {
    await this.usuario.fill(usuario);
    await this.contrasena.fill(contrasena);
    await this.botonIngresar.click();
  }
}
