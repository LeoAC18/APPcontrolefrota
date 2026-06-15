'use strict';
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function initSchema() {
  const client = await pool.connect();
  try {
    await client.query(`
      -- Empresas: cada CNPJ tem um número ANTT
      CREATE TABLE IF NOT EXISTS empresas (
        id         SERIAL PRIMARY KEY,
        nome       VARCHAR(255) NOT NULL,
        cnpj       VARCHAR(18)  NOT NULL UNIQUE,
        antt       VARCHAR(20)  NOT NULL,
        ativa      BOOLEAN      DEFAULT true,
        created_at TIMESTAMPTZ  DEFAULT NOW()
      );

      -- Veículos (cavalos mecânicos) — ANTT vem da empresa vinculada
      CREATE TABLE IF NOT EXISTS veiculos (
        id         SERIAL PRIMARY KEY,
        placa      VARCHAR(10)  NOT NULL UNIQUE,
        modelo     VARCHAR(100),
        empresa_id INTEGER      REFERENCES empresas(id) ON DELETE SET NULL,
        ativo      BOOLEAN      DEFAULT true,
        created_at TIMESTAMPTZ  DEFAULT NOW()
      );

      -- Carretas / semirreboques — podem ser de empresa diferente do cavalo
      CREATE TABLE IF NOT EXISTS carretas (
        id         SERIAL PRIMARY KEY,
        placa      VARCHAR(10)  NOT NULL UNIQUE,
        modelo     VARCHAR(100),
        empresa_id INTEGER      REFERENCES empresas(id) ON DELETE SET NULL,
        ativo      BOOLEAN      DEFAULT true,
        created_at TIMESTAMPTZ  DEFAULT NOW()
      );

      -- Motoristas
      CREATE TABLE IF NOT EXISTS motoristas (
        id              SERIAL PRIMARY KEY,
        nome            VARCHAR(255) NOT NULL,
        cpf             VARCHAR(14)  NOT NULL UNIQUE,
        cnh             VARCHAR(20)  NOT NULL,
        cnh_cat         VARCHAR(2)   DEFAULT 'E',
        tel             VARCHAR(20),
        admissao        DATE,
        empresa_id      INTEGER      REFERENCES empresas(id) ON DELETE SET NULL,
        veiculo_texto   VARCHAR(100),
        status          VARCHAR(20)  DEFAULT 'Disponível',
        vistorias_count INTEGER      DEFAULT 0,
        obs             TEXT,
        created_at      TIMESTAMPTZ  DEFAULT NOW()
      );

      -- Vistorias
      -- cavalo e carreta podem pertencer a empresas/ANTTs diferentes
      CREATE TABLE IF NOT EXISTS vistorias (
        id               SERIAL PRIMARY KEY,
        form_type        VARCHAR(20)  NOT NULL,
        form_codigo      VARCHAR(100),
        processo         VARCHAR(100),
        responsavel      VARCHAR(255),
        motorista_id     INTEGER      REFERENCES motoristas(id) ON DELETE SET NULL,
        motorista_nome   VARCHAR(255),
        cpf              VARCHAR(14),
        -- cavalo
        veiculo_id       INTEGER      REFERENCES veiculos(id)  ON DELETE SET NULL,
        placa_veiculo    VARCHAR(20),
        antt_veiculo     VARCHAR(20),
        empresa_veiculo  VARCHAR(255),
        -- carreta (pode ser de outro ANTT/CNPJ)
        carreta_id       INTEGER      REFERENCES carretas(id)  ON DELETE SET NULL,
        placa_carreta    VARCHAR(20),
        antt_carreta     VARCHAR(20),
        empresa_carreta  VARCHAR(255),
        -- dados da carga
        local_coleta     VARCHAR(255),
        destino          VARCHAR(255),
        num_container    VARCHAR(50),
        tara             NUMERIC,
        max_gross        NUMERIC,
        lacre_armador    VARCHAR(100),
        lacre_mc         VARCHAR(100),
        lacre_exportador VARCHAR(100),
        -- inspeção
        stops            JSONB,
        obs              TEXT,
        data_inspecao    VARCHAR(20),
        hora_inspecao    VARCHAR(10),
        photos_count     INTEGER      DEFAULT 0,
        has_reprovado    BOOLEAN      DEFAULT false,
        -- workflow
        status           VARCHAR(20)  DEFAULT 'pending',
        approved         BOOLEAN      DEFAULT false,
        obs_gestor       TEXT,
        relatorio_base   VARCHAR(255),
        datetime         TIMESTAMPTZ  DEFAULT NOW(),
        created_at       TIMESTAMPTZ  DEFAULT NOW()
      );
    `);

    // ── Migrações de schema ───────────────────────────────────────────
    await client.query(`ALTER TABLE vistorias ADD COLUMN IF NOT EXISTS relatorio_base VARCHAR(255)`);
    await client.query(`ALTER TABLE vistorias ALTER COLUMN placa_veiculo TYPE VARCHAR(20)`);
    await client.query(`ALTER TABLE vistorias ALTER COLUMN placa_carreta TYPE VARCHAR(20)`);
    console.log('[DB] Migrações aplicadas.');

    // ── Seed empresas ────────────────────────────────────────────────
    await client.query(`
      INSERT INTO empresas (nome, cnpj, antt) VALUES
        ('MC Transportes',          '19.326.067/0001-49', '50582811'),
        ('Rota Sul Transportes',    '32.541.098/0001-72', '48291034'),
        ('Trans Litoral Ltda',      '45.872.163/0001-55', '61047829'),
        ('Planalto Cargas Eireli',  '58.134.720/0001-18', '73910256')
      ON CONFLICT (cnpj) DO NOTHING;
    `);

    // ── Seed veículos (cavalos) ───────────────────────────────────────
    // empresa_id resolvido por subquery para ser idempotente
    await client.query(`
      INSERT INTO veiculos (placa, modelo, empresa_id) VALUES
        ('ABC-1D23', 'Scania R450',           (SELECT id FROM empresas WHERE cnpj='19.326.067/0001-49')),
        ('DEF-4T56', 'Volvo FH 500',          (SELECT id FROM empresas WHERE cnpj='19.326.067/0001-49')),
        ('GHI-7P89', 'Mercedes Actros 2651',  (SELECT id FROM empresas WHERE cnpj='19.326.067/0001-49')),
        ('JKL-3M21', 'Iveco Stralis 480',     (SELECT id FROM empresas WHERE cnpj='32.541.098/0001-72')),
        ('MNO-8Q34', 'Volvo FH 460',          (SELECT id FROM empresas WHERE cnpj='32.541.098/0001-72')),
        ('PQR-5S67', 'DAF XF 480',            (SELECT id FROM empresas WHERE cnpj='45.872.163/0001-55')),
        ('STU-2V90', 'Scania S500',            (SELECT id FROM empresas WHERE cnpj='58.134.720/0001-18'))
      ON CONFLICT (placa) DO NOTHING;
    `);

    // ── Seed carretas ─────────────────────────────────────────────────
    await client.query(`
      INSERT INTO carretas (placa, modelo, empresa_id) VALUES
        ('XYZ-9K12', 'Randon SR BA',          (SELECT id FROM empresas WHERE cnpj='19.326.067/0001-49')),
        ('VWX-6L45', 'Noma BC',               (SELECT id FROM empresas WHERE cnpj='19.326.067/0001-49')),
        ('YZA-1N78', 'Librelato LS',          (SELECT id FROM empresas WHERE cnpj='32.541.098/0001-72')),
        ('BCD-4O01', 'Guerra GR',             (SELECT id FROM empresas WHERE cnpj='32.541.098/0001-72')),
        ('EFG-7P34', 'Randon RB',             (SELECT id FROM empresas WHERE cnpj='45.872.163/0001-55')),
        ('HIJ-2Q67', 'Facchini FT',           (SELECT id FROM empresas WHERE cnpj='58.134.720/0001-18')),
        ('KLM-5R90', 'Rodotrem Noma',         (SELECT id FROM empresas WHERE cnpj='58.134.720/0001-18'))
      ON CONFLICT (placa) DO NOTHING;
    `);

    // ── Seed motoristas ───────────────────────────────────────────────
    await client.query(`
      INSERT INTO motoristas (nome, cpf, cnh, cnh_cat, tel, admissao, empresa_id, veiculo_texto, status) VALUES
        ('Carlos Silva',   '123.456.789-00', '12345678', 'E', '(11) 99001-1234', '2021-03-15',
         (SELECT id FROM empresas WHERE cnpj='19.326.067/0001-49'), 'ABC-1D23 — Scania R450', 'Disponível'),
        ('José Alves',     '234.567.890-11', '23456789', 'E', '(11) 98765-4321', '2019-07-01',
         (SELECT id FROM empresas WHERE cnpj='19.326.067/0001-49'), 'DEF-4T56 — Volvo FH 500', 'Disponível'),
        ('Roberto Melo',   '345.678.901-22', '34567890', 'E', '(31) 97654-3210', '2022-01-10',
         (SELECT id FROM empresas WHERE cnpj='32.541.098/0001-72'), 'JKL-3M21 — Iveco Stralis 480', 'Disponível'),
        ('Fernando Lima',  '456.789.012-33', '45678901', 'E', '(21) 96543-2109', '2020-05-20',
         (SELECT id FROM empresas WHERE cnpj='19.326.067/0001-49'), 'GHI-7P89 — Mercedes Actros 2651', 'Disponível'),
        ('Marcos Souza',   '567.890.123-44', '56789012', 'D', '(41) 95432-1098', '2023-02-08',
         (SELECT id FROM empresas WHERE cnpj='45.872.163/0001-55'), 'PQR-5S67 — DAF XF 480', 'Disponível')
      ON CONFLICT (cpf) DO NOTHING;
    `);

    console.log('[DB] Schema e seed inicializados com sucesso.');
  } finally {
    client.release();
  }
}

module.exports = { pool, initSchema };
