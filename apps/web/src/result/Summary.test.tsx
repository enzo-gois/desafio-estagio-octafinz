import type { SimulationView } from '@simulador/shared';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { completedSimulationView, simulationView } from '../testing/fixtures';
import { Summary } from './Summary';

// The sentences have their own table tests (summary-text.test.ts). Here: that the summary shows
// the sentence for the view it gets, and which way back to the form it offers.
vi.mock('./summary-text', () => ({
  summaryText: (view: SimulationView) => `Resumo de ${view.status}, retryable: ${view.retryable}`,
}));

function renderSummary(view: SimulationView) {
  render(
    <MemoryRouter>
      <Summary view={view} />
    </MemoryRouter>,
  );
  return screen.getByRole('region', { name: 'Resumo' });
}

describe('Summary', () => {
  it('shows no way back while the banks are still answering', () => {
    const summary = renderSummary(simulationView());

    expect(summary).toHaveTextContent('Resumo de PROCESSING, retryable: false');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it.each<{ case: string; view: SimulationView; link: string; variant: string }>([
    {
      case: 'with offers, every bank answered',
      view: completedSimulationView({ retryable: false }),
      link: 'Ajustar e simular de novo',
      variant: 'secondary',
    },
    {
      case: 'with offers, some bank did not answer',
      view: completedSimulationView({ retryable: true }),
      link: 'Simular novamente',
      variant: 'primary',
    },
    {
      case: 'without offers, every bank answered',
      view: completedSimulationView({ status: 'COMPLETED_WITHOUT_OFFERS', retryable: false }),
      link: 'Ajustar e simular de novo',
      variant: 'secondary',
    },
    {
      case: 'without offers, some bank did not answer',
      view: completedSimulationView({ status: 'COMPLETED_WITHOUT_OFFERS', retryable: true }),
      link: 'Simular novamente',
      variant: 'primary',
    },
  ])('$case: offers "$link" ($variant)', ({ view, link, variant }) => {
    const summary = renderSummary(view);

    expect(summary).toHaveTextContent(`Resumo de ${view.status}, retryable: ${view.retryable}`);
    const back = screen.getByRole('link', { name: link });
    expect(back).toHaveAttribute('href', '/');
    expect(back).toHaveAttribute('data-variant', variant);
    // One way back, never both.
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });
});
