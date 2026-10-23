import { CONSENT_VERSION, STALE_CONSENT_MESSAGE } from '@simulador/shared';
import { fireEvent, screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../api/client';
import { reloadPage } from '../lib/page';
import { createFakeApi } from '../testing/fake-api';
import { BANK_CATALOG, INPUT, SIMULATION_ID } from '../testing/fixtures';
import { renderApp } from '../testing/render';

vi.mock('../lib/page', () => ({ reloadPage: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const NBSP = ' ';
const submitButton = () => screen.getByRole('button', { name: 'Simular' });
const consentBox = () => screen.getByRole('checkbox', { name: /Autorizo o envio/ });
const messages = () => screen.getByRole('alert');

async function formReady() {
  await screen.findByRole('checkbox', { name: /Autorizo o envio/ });
}

/** Fills every field the way a customer would, with the values of the INPUT fixture. */
async function fillValidForm(user: UserEvent) {
  await formReady();
  await user.type(screen.getByLabelText('Nome completo'), 'Maria Silva');
  await user.type(screen.getByLabelText('E-mail'), 'maria@example.com');
  await user.type(screen.getByLabelText('CPF'), '52998224725');
  fireEvent.change(screen.getByLabelText('Data de nascimento'), {
    target: { value: '1985-04-12' },
  });
  await user.selectOptions(screen.getByLabelText('Tipo de vínculo (opcional)'), 'CLT');
  await user.type(screen.getByLabelText('CNPJ do empregador'), '12abc34501de35');
  await user.type(screen.getByLabelText('Salário líquido (após descontos)'), '500000');
  await user.type(screen.getByLabelText('Valor desejado'), '1000000');
  await user.type(screen.getByLabelText('Número de parcelas'), '48');
  await user.click(consentBox());
}

/** A real ApiClient over a fake fetch: GET /banks answers the catalog, POST the given 400 body. */
function apiAnswering400(body: unknown) {
  const respond = async (input: RequestInfo | URL) =>
    String(input).endsWith('/banks')
      ? new Response(JSON.stringify(BANK_CATALOG), { status: 200 })
      : new Response(JSON.stringify(body), { status: 400 });
  return createApiClient({ baseUrl: '/api', fetch: respond as typeof fetch });
}

describe('consent', () => {
  it('lists the data each bank receives, from GET /banks, with the shared labels', async () => {
    renderApp();
    await formReady();

    const banks = screen.getByRole('list', { name: /enviamos estes dados a cada banco/ });
    expect(
      within(banks)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Banco Alfa: CPF, data de nascimento e salário líquido.',
      'Banco Gama: CPF e CNPJ do empregador.',
    ]);
    expect(
      screen.getByText('Seu nome e seu e-mail não são enviados a nenhum banco e não são gravados.'),
    ).toBeInTheDocument();
    expect(screen.getByText(`Termos de consentimento, versão ${CONSENT_VERSION}.`)).toBeVisible();
    expect(consentBox()).toHaveAccessibleDescription(/Banco Alfa.*não são gravados/s);
    expect(submitButton()).toBeEnabled();
  });

  it('blocks sending while the list of banks is loading', () => {
    const api = createFakeApi();
    api.getBanks.mockReturnValue(new Promise(() => {}));
    renderApp({ api });

    expect(screen.getByRole('status')).toHaveTextContent('Carregando a lista de bancos');
    expect(submitButton()).toBeDisabled();
  });

  it('blocks sending when GET /banks fails, until "Tentar novamente" loads it', async () => {
    const api = createFakeApi();
    const message =
      'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.';
    api.getBanks.mockResolvedValue({ kind: 'network', message });
    const { user } = renderApp({ api });

    expect(await screen.findByText(message)).toBeVisible();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(submitButton()).toBeDisabled();

    api.getBanks.mockResolvedValue({ kind: 'ok', data: BANK_CATALOG });
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    await formReady();
    expect(submitButton()).toBeEnabled();
  });

  it("asks to reload when the API's consent version differs from this page's", async () => {
    const api = createFakeApi();
    api.getBanks.mockResolvedValue({
      kind: 'ok',
      data: { ...BANK_CATALOG, consentVersion: '2026-11-v2' },
    });
    const { user } = renderApp({ api });

    expect(await screen.findByText(STALE_CONSENT_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(submitButton()).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Recarregar a página' }));
    expect(reloadPage).toHaveBeenCalledOnce();
  });
});

describe('validation', () => {
  it('shows the shared messages next to each field and focuses the first invalid one', async () => {
    const api = createFakeApi();
    const { user } = renderApp({ api });
    await formReady();

    await user.click(submitButton());

    const name = screen.getByLabelText('Nome completo');
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Erro: Informe o nome');
    expect(screen.getByLabelText('CPF')).toHaveAccessibleDescription('Erro: CPF inválido');
    expect(consentBox()).toHaveAccessibleDescription(
      /Erro: É necessário autorizar a consulta aos bancos/,
    );
    expect(api.createSimulation).not.toHaveBeenCalled();
  });

  it('clears the message of a field once the customer edits it', async () => {
    const { user } = renderApp();
    await formReady();
    await user.click(submitButton());

    await user.type(screen.getByLabelText('Nome completo'), 'M');

    expect(screen.getByLabelText('Nome completo')).not.toHaveAttribute('aria-invalid');
  });

  it('reports an amount above the cap with the shared message, next to the fixed hint', async () => {
    const api = createFakeApi();
    const { user } = renderApp({ api });
    await fillValidForm(user);
    const amount = screen.getByLabelText('Valor desejado');
    await user.clear(amount);
    await user.type(amount, '100000001');

    await user.click(submitButton());

    expect(amount).toHaveValue(`R$${NBSP}1.000.000,01`);
    expect(amount).toHaveAccessibleDescription(
      `Até R$${NBSP}1.000.000,00. Erro: Valor máximo: R$ 1.000.000,00`,
    );
    expect(api.createSimulation).not.toHaveBeenCalled();
  });

  it('masks as the customer types, with the keyboard each field needs', async () => {
    const { user } = renderApp();
    await formReady();

    const cpf = screen.getByLabelText('CPF');
    await user.type(cpf, '52998224725');
    expect(cpf).toHaveValue('529.982.247-25');
    expect(cpf).toHaveAttribute('inputmode', 'numeric');

    const cnpj = screen.getByLabelText('CNPJ do empregador');
    await user.type(cnpj, '12abc34501de35');
    expect(cnpj).toHaveValue('12.ABC.345/01DE-35');
    expect(cnpj).toHaveAttribute('inputmode', 'text');
    expect(cnpj).toHaveAttribute('autocapitalize', 'characters');

    const salary = screen.getByLabelText('Salário líquido (após descontos)');
    await user.type(salary, '123456');
    expect(salary).toHaveValue(`R$${NBSP}1.234,56`);
    expect(salary).toHaveAttribute('inputmode', 'numeric');
  });

  it('keeps the caret in place when a digit is typed in the middle of the CPF', async () => {
    const { user } = renderApp();
    await formReady();
    const cpf = screen.getByLabelText<HTMLInputElement>('CPF');
    await user.type(cpf, '5299822');

    await user.type(cpf, '1', { initialSelectionStart: 2, initialSelectionEnd: 2 });

    expect(cpf).toHaveValue('521.998.22');
    expect(cpf.selectionStart).toBe(3);
  });
});

describe('submission', () => {
  it('sends the parsed input with the consent version from GET /banks, then opens the result', async () => {
    const api = createFakeApi();
    const { user } = renderApp({ api });
    await fillValidForm(user);

    await user.click(submitButton());

    expect(api.createSimulation).toHaveBeenCalledWith(INPUT, expect.any(AbortSignal));
    expect(await screen.findByRole('heading', { name: 'Resultado da simulação' })).toBeVisible();
    expect(screen.getByText(`Simulação ${SIMULATION_ID} enviada aos bancos.`)).toBeVisible();
  });

  it('sends once when submitted twice before the first answer', async () => {
    const api = createFakeApi();
    api.createSimulation.mockReturnValue(new Promise(() => {}));
    const { user } = renderApp({ api });
    await fillValidForm(user);
    const form = screen.getByRole('form', { name: 'Simule seu empréstimo consignado' });

    // Straight to the form, bypassing the disabled button: only the ref can stop the second one.
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(api.createSimulation).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Enviando…' })).toBeDisabled();
  });

  it('shows field errors of a 400 next to the field and moves the focus there', async () => {
    const api = createFakeApi();
    api.createSimulation.mockResolvedValue({
      kind: 'validation',
      message: 'Dados inválidos.',
      fieldErrors: { employerCnpj: ['CNPJ inválido'] },
      formErrors: [],
    });
    const { user } = renderApp({ api });
    await fillValidForm(user);

    await user.click(submitButton());

    const cnpj = await screen.findByLabelText('CNPJ do empregador');
    expect(cnpj).toHaveFocus();
    expect(cnpj).toHaveAccessibleDescription(/Erro: CNPJ inválido/);
  });

  it('shows a 400 about the consent version as a visible message, with a reload button', async () => {
    const api = apiAnswering400({
      message: 'Dados inválidos.',
      errors: { consentVersion: [STALE_CONSENT_MESSAGE] },
    });
    const { user } = renderApp({ api });
    await fillValidForm(user);

    await user.click(submitButton());

    expect(await within(messages()).findByText(STALE_CONSENT_MESSAGE)).toBeVisible();
    expect(messages()).toHaveFocus();
    await user.click(within(messages()).getByRole('button', { name: 'Recarregar a página' }));
    expect(reloadPage).toHaveBeenCalledOnce();
  });

  it('shows a 400 about a field the form does not have as a visible message', async () => {
    const api = apiAnswering400({
      message: 'Dados inválidos.',
      errors: { channel: ['Canal de atendimento inválido.'] },
    });
    const { user } = renderApp({ api });
    await fillValidForm(user);

    await user.click(submitButton());

    expect(await within(messages()).findByText('Canal de atendimento inválido.')).toBeVisible();
    expect(within(messages()).queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the message of a 400 that has no errors at all', async () => {
    const api = apiAnswering400({ message: 'Corpo da requisição inválido.', errors: {} });
    const { user } = renderApp({ api });
    await fillValidForm(user);

    await user.click(submitButton());

    expect(await within(messages()).findByText('Corpo da requisição inválido.')).toBeVisible();
  });

  it.each([
    [
      '429',
      { kind: 'rate-limited', message: 'Muitas requisições.', retryAfterMs: 30_000 },
      'Muitas requisições. Aguarde cerca de 30 segundos antes de tentar de novo.',
    ],
    [
      '503',
      {
        kind: 'unavailable',
        message: 'O serviço está reiniciando. Tente novamente em instantes.',
        retryAfterMs: 5_000,
      },
      'O serviço está reiniciando. Tente novamente em instantes.',
    ],
    [
      'no connection',
      { kind: 'network', message: 'Não foi possível conectar ao servidor.' },
      'Não foi possível conectar ao servidor.',
    ],
  ] as const)(
    'explains a %s at the top of the form and allows a new try',
    async (_, result, text) => {
      const api = createFakeApi();
      api.createSimulation.mockResolvedValue(result);
      const { user } = renderApp({ api });
      await fillValidForm(user);

      await user.click(submitButton());

      expect(await within(messages()).findByText(text)).toBeVisible();
      expect(messages()).toHaveFocus();
      expect(submitButton()).toBeEnabled();
    },
  );
});

describe('draft', () => {
  it('comes back filled in, except the consent, and keeps nothing in browser storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { user } = renderApp();
    await fillValidForm(user);
    await user.click(submitButton());

    await user.click(await screen.findByRole('link', { name: 'Simular novamente' }));
    await formReady();

    expect(screen.getByLabelText('Nome completo')).toHaveValue('Maria Silva');
    expect(screen.getByLabelText('CPF')).toHaveValue('529.982.247-25');
    expect(screen.getByLabelText('CNPJ do empregador')).toHaveValue('12.ABC.345/01DE-35');
    expect(screen.getByLabelText('Valor desejado')).toHaveValue(`R$${NBSP}10.000,00`);
    expect(consentBox()).not.toBeChecked();
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
  });
});
