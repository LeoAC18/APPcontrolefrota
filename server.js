'use strict';
require('dotenv').config();
const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const { exec }   = require('child_process');
const { gerarWord } = require('./gerarRelatorio');
const { pool, initSchema } = require('./db');
const DB_READY = !!process.env.DATABASE_URL;

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '20mb' }));

// CORS — permite que o app Capacitor (origem diferente) acesse a API
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// App mobile (Capacitor) — servido na raiz
app.use(express.static(path.join(__dirname, 'www')));
// Arquivos do projeto raiz (logo, gestor/)
app.use(express.static(path.join(__dirname)));
app.use('/relatorios', express.static(path.join(__dirname, 'relatorios')));

// Rota explícita para o painel do gestor
app.get('/gestor', (_req, res) => {
  res.sendFile(path.join(__dirname, 'gestor', 'index.html'));
});

const RELAT_DIR = path.join(__dirname, 'relatorios');
if (!fs.existsSync(RELAT_DIR)) fs.mkdirSync(RELAT_DIR);

/* ─────────────────────────────────────────
   PDF via LibreOffice
───────────────────────────────────────── */
function convertPdf(docxPath) {
  return new Promise(resolve => {
    const candidates = [
      'soffice', 'libreoffice',
      '"C:\\Program Files\\LibreOffice\\program\\soffice.exe"',
      '"C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe"',
      '/usr/bin/libreoffice', '/usr/bin/soffice',
    ];
    const outDir = path.dirname(docxPath);
    function tryNext(i) {
      if (i >= candidates.length) return resolve(null);
      exec(`${candidates[i]} --headless --convert-to pdf --outdir "${outDir}" "${docxPath}"`,
        { timeout: 30000 }, err => {
          if (err) return tryNext(i + 1);
          const pdfPath = docxPath.replace(/\.docx$/, '.pdf');
          resolve(fs.existsSync(pdfPath) ? pdfPath : null);
        });
    }
    tryNext(0);
  });
}

/* helper: executa query só se banco estiver pronto */
async function dbQuery(sql, params = []) {
  if (!DB_READY) return { rows: [] };
  return pool.query(sql, params);
}

/* ─────────────────────────────────────────
   STATUS
───────────────────────────────────────── */
app.get('/api/status', async (_req, res) => {
  if (!DB_READY) return res.json({ ok: true, message: 'Sem banco configurado', motoristas: 0, vistorias: 0, pendentes: 0 });
  const { rows } = await dbQuery(
    `SELECT
       (SELECT COUNT(*) FROM motoristas) AS motoristas,
       (SELECT COUNT(*) FROM vistorias)  AS vistorias,
       (SELECT COUNT(*) FROM vistorias WHERE status = 'pending') AS pendentes`
  );
  res.json({ ok: true, message: 'MC Transportes API rodando', port: PORT, ...rows[0] });
});

/* ─────────────────────────────────────────
   EMPRESAS
───────────────────────────────────────── */
app.get('/api/empresas', async (_req, res) => {
  const { rows } = await dbQuery('SELECT * FROM empresas WHERE ativa = true ORDER BY nome');
  res.json(rows);
});

app.post('/api/empresas', async (req, res) => {
  const { nome, cnpj, antt } = req.body;
  const { rows } = await dbQuery(
    'INSERT INTO empresas (nome, cnpj, antt) VALUES ($1, $2, $3) RETURNING *',
    [nome, cnpj, antt]
  );
  res.json(rows[0]);
});

app.put('/api/empresas/:id', async (req, res) => {
  const { nome, cnpj, antt, ativa } = req.body;
  const { rows } = await dbQuery(
    'UPDATE empresas SET nome=$1, cnpj=$2, antt=$3, ativa=$4 WHERE id=$5 RETURNING *',
    [nome, cnpj, antt, ativa ?? true, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
  res.json(rows[0]);
});

/* ─────────────────────────────────────────
   VEÍCULOS (cavalos)
───────────────────────────────────────── */
app.get('/api/veiculos', async (_req, res) => {
  const { rows } = await dbQuery(`
    SELECT v.*, e.nome AS empresa_nome, e.cnpj, e.antt
    FROM veiculos v
    LEFT JOIN empresas e ON e.id = v.empresa_id
    WHERE v.ativo = true
    ORDER BY v.placa
  `);
  res.json(rows);
});

app.post('/api/veiculos', async (req, res) => {
  const { placa, modelo, empresa_id } = req.body;
  const { rows } = await dbQuery(
    'INSERT INTO veiculos (placa, modelo, empresa_id) VALUES ($1, $2, $3) RETURNING *',
    [placa.toUpperCase(), modelo, empresa_id]
  );
  res.json(rows[0]);
});

app.put('/api/veiculos/:id', async (req, res) => {
  const { placa, modelo, empresa_id, ativo } = req.body;
  const { rows } = await dbQuery(
    'UPDATE veiculos SET placa=$1, modelo=$2, empresa_id=$3, ativo=$4 WHERE id=$5 RETURNING *',
    [placa?.toUpperCase(), modelo, empresa_id, ativo ?? true, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
  res.json(rows[0]);
});

/* ─────────────────────────────────────────
   CARRETAS
───────────────────────────────────────── */
app.get('/api/carretas', async (_req, res) => {
  const { rows } = await dbQuery(`
    SELECT c.*, e.nome AS empresa_nome, e.cnpj, e.antt
    FROM carretas c
    LEFT JOIN empresas e ON e.id = c.empresa_id
    WHERE c.ativo = true
    ORDER BY c.placa
  `);
  res.json(rows);
});

app.post('/api/carretas', async (req, res) => {
  const { placa, modelo, empresa_id } = req.body;
  const { rows } = await dbQuery(
    'INSERT INTO carretas (placa, modelo, empresa_id) VALUES ($1, $2, $3) RETURNING *',
    [placa.toUpperCase(), modelo, empresa_id]
  );
  res.json(rows[0]);
});

app.put('/api/carretas/:id', async (req, res) => {
  const { placa, modelo, empresa_id, ativo } = req.body;
  const { rows } = await dbQuery(
    'UPDATE carretas SET placa=$1, modelo=$2, empresa_id=$3, ativo=$4 WHERE id=$5 RETURNING *',
    [placa?.toUpperCase(), modelo, empresa_id, ativo ?? true, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
  res.json(rows[0]);
});

/* ─────────────────────────────────────────
   MOTORISTAS
───────────────────────────────────────── */
app.get('/api/motoristas', async (_req, res) => {
  const { rows } = await dbQuery(`
    SELECT m.*,
           e.nome AS empresa_nome, e.cnpj, e.antt
    FROM motoristas m
    LEFT JOIN empresas e ON e.id = m.empresa_id
    ORDER BY m.nome
  `);
  // Compatibilidade com o painel: campo "vistorias" e "cnhCat"
  res.json(rows.map(r => ({
    ...r,
    vistorias: r.vistorias_count,
    cnhCat: r.cnh_cat,
    veiculo: r.veiculo_texto,
  })));
});

app.post('/api/motoristas', async (req, res) => {
  const { nome, cpf, cnh, cnhCat, tel, admissao, empresa_id, veiculo, status, obs } = req.body;
  const { rows } = await dbQuery(
    `INSERT INTO motoristas (nome, cpf, cnh, cnh_cat, tel, admissao, empresa_id, veiculo_texto, status, obs)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [nome, cpf, cnh, cnhCat || 'E', tel, admissao || null, empresa_id || null, veiculo || null, status || 'Disponível', obs || '']
  );
  const m = rows[0];
  res.json({ ...m, vistorias: m.vistorias_count, cnhCat: m.cnh_cat, veiculo: m.veiculo_texto });
});

app.put('/api/motoristas/:id', async (req, res) => {
  const { nome, cpf, cnh, cnhCat, tel, admissao, empresa_id, veiculo, status, obs } = req.body;
  const { rows } = await dbQuery(
    `UPDATE motoristas SET nome=$1, cpf=$2, cnh=$3, cnh_cat=$4, tel=$5, admissao=$6,
     empresa_id=$7, veiculo_texto=$8, status=$9, obs=$10 WHERE id=$11 RETURNING *`,
    [nome, cpf, cnh, cnhCat || 'E', tel, admissao || null, empresa_id || null, veiculo || null, status, obs || '', req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
  const m = rows[0];
  res.json({ ...m, vistorias: m.vistorias_count, cnhCat: m.cnh_cat, veiculo: m.veiculo_texto });
});

app.delete('/api/motoristas/:id', async (req, res) => {
  await dbQuery('DELETE FROM motoristas WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

/* ─────────────────────────────────────────
   VISTORIAS
───────────────────────────────────────── */
app.get('/api/vistorias', async (_req, res) => {
  const { rows } = await dbQuery(`
    SELECT v.*,
           ev.nome AS empresa_veiculo_nome,
           ec.nome AS empresa_carreta_nome
    FROM vistorias v
    LEFT JOIN veiculos vv ON vv.id = v.veiculo_id
    LEFT JOIN empresas ev ON ev.id = vv.empresa_id
    LEFT JOIN carretas cc ON cc.id = v.carreta_id
    LEFT JOIN empresas ec ON ec.id = cc.empresa_id
    ORDER BY v.datetime DESC
  `);
  res.json(rows.map(r => ({
    ...r,
    motorista:    r.motorista_nome,
    placa:        r.placa_veiculo,
    nf:           r.processo || '—',
    km:           0,
    carga:        '—',
    urgencia:     r.has_reprovado ? 'Com reprovação' : 'Sem ocorrência',
    avarias:      r.avarias || [],
    noises:       r.noises  || [],
    wordUrl:      r.relatorio_base && fs.existsSync(path.join(RELAT_DIR, `${r.relatorio_base}.docx`)) ? `/relatorios/${r.relatorio_base}.docx` : null,
    pdfUrl:       r.relatorio_base && fs.existsSync(path.join(RELAT_DIR, `${r.relatorio_base}.pdf`))  ? `/relatorios/${r.relatorio_base}.pdf`  : null,
    wordFilename: r.relatorio_base ? `${r.relatorio_base}.docx` : null,
    pdfFilename:  r.relatorio_base ? `${r.relatorio_base}.pdf`  : null,
  })));
});

app.post('/api/vistorias', async (req, res) => {
  try {
    const d = req.body;
    if (!d || !d.formType) return res.status(400).json({ ok: false, error: 'Dados inválidos' });

    // Resolve veiculo_id e antt a partir da placa, se existir no banco
    let veiculoId = null, anttVeiculo = null, empresaVeiculo = null;
    if (d.placaVeiculo) {
      const vq = await dbQuery(`
        SELECT vv.id, e.antt, e.nome
        FROM veiculos vv LEFT JOIN empresas e ON e.id = vv.empresa_id
        WHERE vv.placa = $1`, [d.placaVeiculo.toUpperCase()]);
      if (vq.rows.length) {
        veiculoId      = vq.rows[0].id;
        anttVeiculo    = vq.rows[0].antt;
        empresaVeiculo = vq.rows[0].nome;
      }
    }

    // Resolve carreta_id e antt (pode ser empresa diferente)
    let carretaId = null, anttCarreta = null, empresaCarreta = null;
    if (d.placaCarreta) {
      const cq = await dbQuery(`
        SELECT cc.id, e.antt, e.nome
        FROM carretas cc LEFT JOIN empresas e ON e.id = cc.empresa_id
        WHERE cc.placa = $1`, [d.placaCarreta.toUpperCase()]);
      if (cq.rows.length) {
        carretaId      = cq.rows[0].id;
        anttCarreta    = cq.rows[0].antt;
        empresaCarreta = cq.rows[0].nome;
      }
    }

    // Resolve motorista_id
    let motoristaBd = null;
    if (d.motorista) {
      const mq = await dbQuery(
        'SELECT id FROM motoristas WHERE LOWER(nome) = LOWER($1) LIMIT 1', [d.motorista]);
      if (mq.rows.length) motoristaBd = mq.rows[0].id;
    }

    // Gera nome do arquivo antes do INSERT para salvar no banco
    const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const nomeSafe = (d.motorista || 'motorista').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
    const base     = `${(d.formType || 'vistoria').toUpperCase()}_${nomeSafe}_${ts}`;

    const { rows } = await dbQuery(`
      INSERT INTO vistorias (
        form_type, form_codigo, processo, responsavel,
        motorista_id, motorista_nome, cpf,
        veiculo_id, placa_veiculo, antt_veiculo, empresa_veiculo,
        carreta_id, placa_carreta, antt_carreta, empresa_carreta,
        local_coleta, destino, num_container, tara, max_gross,
        lacre_armador, lacre_mc, lacre_exportador,
        stops, obs, data_inspecao, hora_inspecao,
        photos_count, has_reprovado, status, datetime, relatorio_base
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
        $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,'pending',$30,$31
      ) RETURNING *`,
      [
        d.formType, d.formCodigo, d.processo, d.responsavel,
        motoristaBd, d.motorista, d.cpf,
        veiculoId, d.placaVeiculo, anttVeiculo, empresaVeiculo,
        carretaId, d.placaCarreta, anttCarreta, empresaCarreta,
        d.localColeta, d.destino, d.numContainer, d.tara || null, d.maxGross || null,
        d.lacreArmador, d.lacreMC, d.lacreExportador,
        JSON.stringify(d.stops || []), d.obs, d.dataInspecao, d.horaInspecao,
        d.photos || 0, d.hasReprovado || false, new Date(d.datetime || Date.now()),
        base,
      ]
    );

    // Incrementa contador do motorista
    if (motoristaBd) {
      await dbQuery(
        'UPDATE motoristas SET vistorias_count = vistorias_count + 1 WHERE id = $1',
        [motoristaBd]
      );
    }

    // Gera Word — o relatório usa tabela fixa de 4 paradas; preenche as faltantes com "pulada"
    const stopsForReport = d.stops ? [...d.stops].slice(0, 4) : [];
    while (stopsForReport.length < 4) {
      stopsForReport.push({
        tipo: `${stopsForReport.length}ª Parada`,
        motivo: '', local: '', items: {}, comentarios: '', pulada: true
      });
    }
    console.log('[WORD] stops count:', stopsForReport.length, '| tipos:', stopsForReport.map(s => s.tipo));
    const docxPath = path.join(RELAT_DIR, `${base}.docx`);
    const buffer   = await gerarWord({ ...d, stops: stopsForReport });
    fs.writeFileSync(docxPath, buffer);

    const pdfPath = await convertPdf(docxPath);
    const pdfName = pdfPath ? path.basename(pdfPath) : null;

    const savedId = (rows && rows.length) ? rows[0].id : null;
    console.log(`[VISTORIA] Salva no banco: id=${savedId} motorista="${d.motorista}" tipo=${d.formType}`);
    res.json({
      ok: true,
      id: savedId,
      wordUrl:      `/relatorios/${base}.docx`,
      wordFilename: `${base}.docx`,
      pdfUrl:       pdfName ? `/relatorios/${pdfName}` : null,
      pdfFilename:  pdfName || null,
    });
  } catch (err) {
    console.error('[ERRO] POST /api/vistorias:', err.stack || err);
    res.status(500).json({ ok: false, error: err.message + ' | ' + (err.stack || '').split('\n')[1] });
  }
});

app.patch('/api/vistorias/:id/status', async (req, res) => {
  const { status, obs } = req.body;
  const { rows } = await dbQuery(
    `UPDATE vistorias SET status=$1, approved=$2, obs_gestor=COALESCE($3, obs_gestor)
     WHERE id=$4 RETURNING *`,
    [status, status === 'approved', obs || null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
  res.json(rows[0]);
});

/* ─────────────────────────────────────────
   INIT
───────────────────────────────────────── */
const boot = DB_READY ? initSchema().catch(err => console.error('[DB] initSchema falhou:', err.message)) : Promise.resolve();

boot.then(() => {
  app.listen(PORT, () => {
    console.log(`\n✅ MC Transportes App`);
    console.log(`   → App motorista: http://localhost:${PORT}`);
    console.log(`   → Painel gestor: http://localhost:${PORT}/gestor`);
    console.log(`   → API status:    http://localhost:${PORT}/api/status`);
    if (!DB_READY) console.log(`   ⚠️  DATABASE_URL não definida — APIs retornam dados vazios\n`);
    else console.log('');
  });
}).catch(err => {
  console.error('[ERRO] Falha ao inicializar banco:', err.message);
  process.exit(1);
});
