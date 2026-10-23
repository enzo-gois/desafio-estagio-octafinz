import { useNavigate } from 'react-router';
import { SimulationForm } from './SimulationForm';
import { useBankCatalog } from './use-bank-catalog';

export function SimulationPage() {
  const { state, retry } = useBankCatalog();
  const navigate = useNavigate();

  return (
    <SimulationForm
      catalog={state}
      onRetryCatalog={retry}
      onCreated={(id) => void navigate(`/simulacoes/${encodeURIComponent(id)}`)}
    />
  );
}
