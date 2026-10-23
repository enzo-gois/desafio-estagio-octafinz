import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders with the limits from @simulador/shared', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Simulador de empréstimo consignado' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Prazos de 6 a 96 parcelas.')).toBeInTheDocument();
  });
});
