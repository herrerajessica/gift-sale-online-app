import { Page, Locator } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly correo: Locator;
  readonly contrasena: Locator;
  readonly botonEntrar: Locator;
  readonly mensajeError: Locator;

  constructor(page: Page) {
    this.page = page;
    this.correo = page.getByLabel('Correo');
    this.contrasena = page.getByLabel('Contraseña', { exact: true });
    this.botonEntrar = page.getByRole('button', { name: 'Entrar', exact: true });
    this.mensajeError = page.locator('#loginErr');
  }

  async abrir() {
    await this.page.goto('/#entrar');
  }

  async login(correo: string, contrasena: string) {
    await this.correo.fill(correo);
    await this.contrasena.fill(contrasena);
    await this.botonEntrar.click();
  }
}
