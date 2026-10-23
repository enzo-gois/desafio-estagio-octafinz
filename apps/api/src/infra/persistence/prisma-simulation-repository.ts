import { type BankResult, bankResultSchema } from '@simulador/shared';
import type {
  FinalBankResult,
  NewSimulation,
  SimulationRepository,
  StoredSimulation,
} from '../../application/ports/simulation-repository';
import type { PrismaClient } from './prisma-client';

type ResultRow = {
  bankId: string;
  status: string;
  reason: string | null;
  amountCents: number | null;
  installments: number | null;
  monthlyRate: number | null;
  installmentCents: number | null;
  latencyMs: number | null;
  attempts: number | null;
};

function toColumns(result: FinalBankResult) {
  const offer = result.status === 'APPROVED' ? result.offer : undefined;
  return {
    status: result.status,
    reason: result.reason ?? null,
    amountCents: offer?.amountCents ?? null,
    installments: offer?.installments ?? null,
    monthlyRate: offer?.monthlyRate ?? null,
    installmentCents: offer?.installmentCents ?? null,
    latencyMs: result.latencyMs ?? null,
    attempts: result.attempts ?? null,
  };
}

// Rows are validated with the shared schema on the way out: a corrupted row fails loudly here
// instead of reaching the customer as a malformed response.
function fromRow(row: ResultRow): BankResult {
  return bankResultSchema.parse({
    bankId: row.bankId,
    status: row.status,
    ...(row.reason !== null && { reason: row.reason }),
    ...(row.latencyMs !== null && { latencyMs: row.latencyMs }),
    ...(row.attempts !== null && { attempts: row.attempts }),
    ...(row.status === 'APPROVED' && {
      offer: {
        amountCents: row.amountCents,
        installments: row.installments,
        monthlyRate: row.monthlyRate,
        installmentCents: row.installmentCents,
      },
    }),
  });
}

export class PrismaSimulationRepository implements SimulationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create({ bankIds, margin, ...simulation }: NewSimulation): Promise<void> {
    // A nested create runs in one transaction: the simulation never exists without its rows.
    await this.prisma.simulation.create({
      data: {
        ...simulation,
        marginPercent: margin.percent,
        marginReferenceRate: margin.referenceMonthlyRate,
        marginCents: margin.marginCents,
        estimatedInstallmentCents: margin.estimatedInstallmentCents,
        fitsMargin: margin.fitsMargin,
        commitmentBps: margin.commitmentBps,
        results: { create: bankIds.map((bankId) => ({ bankId, status: 'PENDING' })) },
      },
    });
  }

  async findById(id: string): Promise<StoredSimulation | undefined> {
    const row = await this.prisma.simulation.findUnique({
      where: { id },
      include: { results: { orderBy: { bankId: 'asc' } } },
    });
    if (!row) return undefined;

    return {
      id: row.id,
      createdAt: row.createdAt,
      consentedAt: row.consentedAt,
      consentVersion: row.consentVersion,
      requestedAmountCents: row.requestedAmountCents,
      installments: row.installments,
      cpfMasked: row.cpfMasked,
      margin: {
        percent: row.marginPercent,
        referenceMonthlyRate: row.marginReferenceRate,
        marginCents: row.marginCents,
        estimatedInstallmentCents: row.estimatedInstallmentCents,
        fitsMargin: row.fitsMargin,
        commitmentBps: row.commitmentBps,
      },
      results: row.results.map(fromRow),
    };
  }

  async completeBankResult(simulationId: string, result: FinalBankResult): Promise<boolean> {
    // Conditional update: the WHERE on status makes "PENDING -> final" atomic in the database,
    // so concurrent answers (or an answer racing the expiry) never overwrite each other.
    const { count } = await this.prisma.simulationBankResult.updateMany({
      where: { simulationId, bankId: result.bankId, status: 'PENDING' },
      data: toColumns(result),
    });
    return count === 1;
  }

  async expirePending(
    cutoff: Date,
    reason: string,
    filter?: { simulationId: string },
  ): Promise<number> {
    const { count } = await this.prisma.simulationBankResult.updateMany({
      where: {
        status: 'PENDING',
        ...(filter && { simulationId: filter.simulationId }),
        simulation: { createdAt: { lt: cutoff } },
      },
      data: { status: 'UNAVAILABLE', reason },
    });
    return count;
  }
}
