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
        placa_veiculo    VARCHAR(10),
        antt_veiculo     VARCHAR(20),
        empresa_veiculo  VARCHAR(255),
        -- carreta (pode ser de outro ANTT/CNPJ)
        carreta_id       INTEGER      REFERENCES carretas(id)  ON DELETE SET NULL,
        placa_carreta    VARCHAR(10),
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
        datetime         TIMESTAMPTZ  DEFAULT NOW(),
        created_at       TIMESTAMPTZ  DEFAULT NOW()
      );
    `);

    // Seed: MC Transportes como empresa padrão
    await client.query(`
      INSERT INTO empresas (nome, cnpj, antt)
      VALUES ('MC Transportes', '19.326.067/0001-49', '50582811')
      ON CONFLICT (cnpj) DO NOTHING;
    `);

    console.log('[DB] Schema inicializado com sucesso.');
  } finally {
    client.release();
  }
}

module.exports = { pool, initSchema };
