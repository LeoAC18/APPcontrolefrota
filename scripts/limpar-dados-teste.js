'use strict';
/**
 * Limpeza de dados de teste — deixa o sistema zerado para produção.
 *
 * Uso:
 *   node scripts/limpar-dados-teste.js            → só mostra o que seria apagado (dry-run)
 *   node scripts/limpar-dados-teste.js --confirmar → apaga de verdade
 *
 * Requer DATABASE_URL no .env (usar a DATABASE_PUBLIC_URL do Railway
 * quando rodar da sua máquina).
 *
 * O que faz:
 *   1. Apaga TODAS as vistorias (fotos e histórico de alterações vão junto).
 *   2. Apaga motoristas de teste (CPFs do seed antigo) e seus logins.
 *   3. Apaga veículos e carretas de teste (placas do seed antigo).
 *   4. Apaga empresas de teste (mantém MC Transportes).
 *   5. Zera vistorias_count dos motoristas restantes.
 *   6. Reinicia os contadores de ID (próxima vistoria = nº 1).
 */
require('dotenv').config();
const { Pool } = require('pg');

const CONFIRMAR = process.argv.includes('--confirmar');

// Dados do seed antigo (db.js) — identificam o que é teste
const CPFS_TESTE = [
  '123.456.789-00', '234.567.890-11', '345.678.901-22',
  '456.789.012-33', '567.890.123-44',
];
const PLACAS_VEICULOS_TESTE = [
  'ABC-1D23', 'DEF-4T56', 'GHI-7P89', 'JKL-3M21',
  'MNO-8Q34', 'PQR-5S67', 'STU-2V90',
];
const PLACAS_CARRETAS_TESTE = [
  'XYZ-9K12', 'VWX-6L45', 'YZA-1N78', 'BCD-4O01',
  'EFG-7P34', 'HIJ-2Q67', 'KLM-5R90',
];
const CNPJS_TESTE = [
  '32.541.098/0001-72', // Rota Sul Transportes
  '45.872.163/0001-55', // Trans Litoral Ltda
  '58.134.720/0001-18', // Planalto Cargas Eireli
];

(async () => {
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('nome_banco')) {
    console.error('ERRO: DATABASE_URL não configurada no .env (use a DATABASE_PUBLIC_URL do Railway).');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();

  try {
    // ── Levantamento ─────────────────────────────────────────────────
    const q = async (sql, params) => (await client.query(sql, params)).rows;
    const count = async (sql, params) => Number((await q(sql, params))[0].n);

    const nVistorias   = await count(`SELECT COUNT(*) n FROM vistorias`);
    const nFotos       = await count(`SELECT COUNT(*) n FROM vistoria_fotos`);
    const nAlteracoes  = await count(`SELECT COUNT(*) n FROM vistoria_alteracoes`);
    const motTeste     = await q(`SELECT id, nome, cpf FROM motoristas WHERE cpf = ANY($1)`, [CPFS_TESTE]);
    const veicTeste    = await q(`SELECT id, placa FROM veiculos WHERE placa = ANY($1)`, [PLACAS_VEICULOS_TESTE]);
    const carrTeste    = await q(`SELECT id, placa FROM carretas WHERE placa = ANY($1)`, [PLACAS_CARRETAS_TESTE]);
    const empTeste     = await q(`SELECT id, nome FROM empresas WHERE cnpj = ANY($1)`, [CNPJS_TESTE]);
    const cpfsDigits   = CPFS_TESTE.map(c => c.replace(/\D/g, ''));
    const usersTeste   = await q(
      `SELECT id, nome, login FROM usuarios WHERE tipo='motorista' AND (login = ANY($1) OR motorista_id = ANY($2::int[]))`,
      [cpfsDigits, motTeste.map(m => m.id).concat([0])]
    );
    const motReais     = await q(`SELECT id, nome FROM motoristas WHERE NOT (cpf = ANY($1))`, [CPFS_TESTE]);

    console.log('=== O que será apagado ===');
    console.log(`Vistorias:            ${nVistorias} (todas)`);
    console.log(`Fotos de lacre:       ${nFotos}`);
    console.log(`Alterações de gestor: ${nAlteracoes}`);
    console.log(`Motoristas de teste:  ${motTeste.length}${motTeste.length ? ' → ' + motTeste.map(m => m.nome).join(', ') : ''}`);
    console.log(`Logins de teste:      ${usersTeste.length}${usersTeste.length ? ' → ' + usersTeste.map(u => u.login).join(', ') : ''}`);
    console.log(`Veículos de teste:    ${veicTeste.length}${veicTeste.length ? ' → ' + veicTeste.map(v => v.placa).join(', ') : ''}`);
    console.log(`Carretas de teste:    ${carrTeste.length}${carrTeste.length ? ' → ' + carrTeste.map(c => c.placa).join(', ') : ''}`);
    console.log(`Empresas de teste:    ${empTeste.length}${empTeste.length ? ' → ' + empTeste.map(e => e.nome).join(', ') : ''}`);
    console.log('\n=== O que será MANTIDO ===');
    console.log(`Motoristas reais:     ${motReais.length}${motReais.length ? ' → ' + motReais.map(m => m.nome).join(', ') : ''}`);
    console.log(`Empresa MC Transportes, usuário admin e demais cadastros reais.`);

    if (!CONFIRMAR) {
      console.log('\n[DRY-RUN] Nada foi apagado. Rode com --confirmar para executar.');
      return;
    }

    // ── Execução ─────────────────────────────────────────────────────
    await client.query('BEGIN');

    // 1. Vistorias (fotos e alterações caem por ON DELETE CASCADE)
    await client.query(`DELETE FROM vistorias`);

    // 2. Logins e motoristas de teste
    await client.query(
      `DELETE FROM usuarios WHERE tipo='motorista' AND (login = ANY($1) OR motorista_id IN (SELECT id FROM motoristas WHERE cpf = ANY($2)))`,
      [cpfsDigits, CPFS_TESTE]
    );
    await client.query(`DELETE FROM motoristas WHERE cpf = ANY($1)`, [CPFS_TESTE]);

    // 3. Veículos e carretas de teste
    await client.query(`DELETE FROM veiculos WHERE placa = ANY($1)`, [PLACAS_VEICULOS_TESTE]);
    await client.query(`DELETE FROM carretas WHERE placa = ANY($1)`, [PLACAS_CARRETAS_TESTE]);

    // 4. Empresas de teste
    await client.query(`DELETE FROM empresas WHERE cnpj = ANY($1)`, [CNPJS_TESTE]);

    // 5. Zera contador de vistorias dos motoristas reais
    await client.query(`UPDATE motoristas SET vistorias_count = 0`);

    // 6. Reinicia sequências de ID
    await client.query(`ALTER SEQUENCE vistorias_id_seq RESTART WITH 1`);
    await client.query(`ALTER SEQUENCE vistoria_fotos_id_seq RESTART WITH 1`);
    await client.query(`ALTER SEQUENCE vistoria_alteracoes_id_seq RESTART WITH 1`);

    await client.query('COMMIT');

    // ── Conferência final ────────────────────────────────────────────
    const restV = await count(`SELECT COUNT(*) n FROM vistorias`);
    const restM = await q(`SELECT nome FROM motoristas ORDER BY nome`);
    const restU = await count(`SELECT COUNT(*) n FROM usuarios`);
    console.log('\n=== Limpeza concluída ===');
    console.log(`Vistorias restantes: ${restV}`);
    console.log(`Motoristas restantes: ${restM.length}${restM.length ? ' → ' + restM.map(m => m.nome).join(', ') : ''}`);
    console.log(`Usuários restantes (admin + motoristas reais): ${restU}`);
    console.log('Sistema zerado — próxima vistoria será a nº 1.');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('ERRO — nada foi apagado (transação revertida):', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
