-- CreateTable
CREATE TABLE "simulations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_at" DATETIME NOT NULL,
    "consented_at" DATETIME NOT NULL,
    "consent_version" TEXT NOT NULL,
    "requested_amount_cents" INTEGER NOT NULL,
    "installments" INTEGER NOT NULL,
    "cpf_masked" TEXT NOT NULL,
    "margin_percent" INTEGER NOT NULL,
    "margin_reference_rate" REAL NOT NULL,
    "margin_cents" INTEGER NOT NULL,
    "estimated_installment_cents" INTEGER NOT NULL,
    "fits_margin" BOOLEAN NOT NULL,
    "commitment_bps" INTEGER
);

-- CreateTable
CREATE TABLE "simulation_bank_results" (
    "simulation_id" TEXT NOT NULL,
    "bank_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "amount_cents" INTEGER,
    "installments" INTEGER,
    "monthly_rate" REAL,
    "installment_cents" INTEGER,
    "latency_ms" INTEGER,
    "attempts" INTEGER,
    "updated_at" DATETIME NOT NULL,

    PRIMARY KEY ("simulation_id", "bank_id"),
    CONSTRAINT "simulation_bank_results_simulation_id_fkey" FOREIGN KEY ("simulation_id") REFERENCES "simulations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "simulations_created_at_idx" ON "simulations"("created_at");

-- CreateIndex
CREATE INDEX "simulation_bank_results_status_idx" ON "simulation_bank_results"("status");
