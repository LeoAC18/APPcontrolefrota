'use strict';
require('dotenv').config();
const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const { gerarWord } = require('./gerarRelatorio');
const { gerarPdf }  = require('./gerarRelatorioPdf');
const { pool, initSchema } = require('./db');
const DB_READY = !!process.env.DATABASE_URL;

const JWT_SECRET = process.env.JWT_SECRET || 'mc-frota-secret-2024';

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '20mb' }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const RELAT_DIR = path.join(__dirname, 'relatorios');
if (!fs.existsSync(RELAT_DIR)) fs.mkdirSync(RELAT_DIR);

// Arquivos estáticos — sem autenticação
app.use(express.static(path.join(__dirname, 'www')));
app.use(express.static(path.join(__dirname)));
app.use('/relatorios', express.static(RELAT_DIR));

// Rota explícita para o painel do gestor
app.get('/gestor', (_req, res) => {
  res.sendFile(path.join(__dirname, 'gestor', 'index.html'));
});

/* helper: executa query só se banco estiver pronto */
async function dbQuery(sql, params = []) {
  if (!DB_READY) return { rows: [] };
  return pool.query(sql, params);
}

/* ─────────────────────────────────────────
   AUTH MIDDLEWARE
───────────────────────────────────────── */
function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

function requireGestor(req, res, next) {
  if (req.user?.tipo !== 'gestor') {
    return res.status(403).json({ error: 'Acesso restrito ao gestor' });
  }
  next();
}

/* ─────────────────────────────────────────
   AUTH
───────────────────────────────────────── */
app.post('/api/auth/login', async (req, res) => {
  try {
    const { login, senha } = req.body;
    if (!login || !senha) return res.status(400).json({ error: 'Login e senha obrigatórios' });

    const { rows } = await dbQuery(`
      SELECT u.*, m.nome AS motorista_nome, m.cpf AS motorista_cpf
      FROM usuarios u
      LEFT JOIN motoristas m ON m.id = u.motorista_id
      WHERE u.login = $1 AND u.ativo = true
    `, [login.trim()]);

    if (!rows.length) return res.status(401).json({ error: 'Credenciais inválidas' });
    const user = rows[0];

    const ok = await bcrypt.compare(senha, user.senha_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciais inválidas' });

    const payload = {
      id:           user.id,
      nome:         user.nome,
      tipo:         user.tipo,
      motorista_id: user.motorista_id,
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '10h' });

    res.json({
      token,
      nome:         user.nome,
      tipo:         user.tipo,
      motorista_id: user.motorista_id,
      motorista_cpf: user.motorista_cpf || null,
    });
  } catch (err) {
    console.error('[AUTH] login:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.get('/api/auth/me', verifyToken, (req, res) => res.json(req.user));

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
app.get('/api/empresas', verifyToken, async (_req, res) => {
  const { rows } = await dbQuery('SELECT * FROM empresas WHERE ativa = true ORDER BY nome');
  res.json(rows);
});

app.post('/api/empresas', verifyToken, requireGestor, async (req, res) => {
  const { nome, cnpj, antt } = req.body;
  const { rows } = await dbQuery(
    'INSERT INTO empresas (nome, cnpj, antt) VALUES ($1, $2, $3) RETURNING *',
    [nome, cnpj, antt]
  );
  res.json(rows[0]);
});

app.put('/api/empresas/:id', verifyToken, requireGestor, async (req, res) => {
  const { nome, cnpj, antt, ativa } = req.body;
  const { rows } = await dbQuery(
    'UPDATE empresas SET nome=$1, cnpj=$2, antt=$3, ativa=$4 WHERE id=$5 RETURNING *',
    [nome, cnpj, antt, ativa ?? true, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
  res.json(rows[0]);
});

/* ─────────────────────────────────────────
   VEÍCULOS
───────────────────────────────────────── */
app.get('/api/veiculos', verifyToken, async (_req, res) => {
  const { rows } = await dbQuery(`
    SELECT v.*, e.nome AS empresa_nome, e.cnpj, e.antt
    FROM veiculos v
    LEFT JOIN empresas e ON e.id = v.empresa_id
    WHERE v.ativo = true
    ORDER BY v.placa
  `);
  res.json(rows);
});

app.post('/api/veiculos', verifyToken, requireGestor, async (req, res) => {
  const { placa, modelo, empresa_id } = req.body;
  const { rows } = await dbQuery(
    'INSERT INTO veiculos (placa, modelo, empresa_id) VALUES ($1, $2, $3) RETURNING *',
    [placa.toUpperCase(), modelo, empresa_id]
  );
  res.json(rows[0]);
});

app.put('/api/veiculos/:id', verifyToken, requireGestor, async (req, res) => {
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
app.get('/api/carretas', verifyToken, async (_req, res) => {
  const { rows } = await dbQuery(`
    SELECT c.*, e.nome AS empresa_nome, e.cnpj, e.antt
    FROM carretas c
    LEFT JOIN empresas e ON e.id = c.empresa_id
    WHERE c.ativo = true
    ORDER BY c.placa
  `);
  res.json(rows);
});

app.post('/api/carretas', verifyToken, requireGestor, async (req, res) => {
  const { placa, modelo, empresa_id } = req.body;
  const { rows } = await dbQuery(
    'INSERT INTO carretas (placa, modelo, empresa_id) VALUES ($1, $2, $3) RETURNING *',
    [placa.toUpperCase(), modelo, empresa_id]
  );
  res.json(rows[0]);
});

app.put('/api/carretas/:id', verifyToken, requireGestor, async (req, res) => {
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
app.get('/api/motoristas', verifyToken, async (_req, res) => {
  const { rows } = await dbQuery(`
    SELECT m.*, e.nome AS empresa_nome, e.cnpj, e.antt
    FROM motoristas m
    LEFT JOIN empresas e ON e.id = m.empresa_id
    ORDER BY m.nome
  `);
  res.json(rows.map(r => ({
    ...r,
    vistorias: r.vistorias_count,
    cnhCat: r.cnh_cat,
    veiculo: r.veiculo_texto,
  })));
});

app.post('/api/motoristas', verifyToken, requireGestor, async (req, res) => {
  const { nome, cpf, cnh, cnhCat, tel, admissao, empresa_id, veiculo, status, obs } = req.body;
  const { rows } = await dbQuery(
    `INSERT INTO motoristas (nome, cpf, cnh, cnh_cat, tel, admissao, empresa_id, veiculo_texto, status, obs)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [nome, cpf, cnh, cnhCat || 'E', tel, admissao || null, empresa_id || null, veiculo || null, status || 'Disponível', obs || '']
  );
  const m = rows[0];

  // Cria usuário para o novo motorista (login = CPF digits, senha = 1234)
  try {
    const hash = await bcrypt.hash('1234', 10);
    const loginCpf = cpf.replace(/[^0-9]/g, '');
    await dbQuery(
      `INSERT INTO usuarios (nome, login, senha_hash, tipo, motorista_id) VALUES ($1,$2,$3,'motorista',$4) ON CONFLICT (login) DO NOTHING`,
      [nome, loginCpf, hash, m.id]
    );
  } catch (_) {}

  res.json({ ...m, vistorias: m.vistorias_count, cnhCat: m.cnh_cat, veiculo: m.veiculo_texto });
});

app.put('/api/motoristas/:id', verifyToken, requireGestor, async (req, res) => {
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

app.delete('/api/motoristas/:id', verifyToken, requireGestor, async (req, res) => {
  await dbQuery('DELETE FROM motoristas WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

/* ─────────────────────────────────────────
   VISTORIAS
───────────────────────────────────────── */
function formatVistoria(r) {
  return {
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
  };
}

// Todas as vistorias — gestor
app.get('/api/vistorias', verifyToken, requireGestor, async (_req, res) => {
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
  res.json(rows.map(formatVistoria));
});

// Vistorias do motorista logado
app.get('/api/vistorias/minhas', verifyToken, async (req, res) => {
  if (!req.user.motorista_id) return res.status(403).json({ error: 'Não é motorista' });
  const { rows } = await dbQuery(`
    SELECT v.* FROM vistorias v
    WHERE v.motorista_id = $1
    ORDER BY v.datetime DESC
    LIMIT 50
  `, [req.user.motorista_id]);
  res.json(rows.map(r => ({
    ...r,
    wordUrl:  r.relatorio_base && fs.existsSync(path.join(RELAT_DIR, `${r.relatorio_base}.docx`)) ? `/relatorios/${r.relatorio_base}.docx` : null,
    pdfUrl:   r.relatorio_base && fs.existsSync(path.join(RELAT_DIR, `${r.relatorio_base}.pdf`))  ? `/relatorios/${r.relatorio_base}.pdf`  : null,
  })));
});

// Histórico de alterações de uma vistoria — gestor
app.get('/api/vistorias/:id/alteracoes', verifyToken, requireGestor, async (req, res) => {
  const { rows } = await dbQuery(
    'SELECT * FROM vistoria_alteracoes WHERE vistoria_id=$1 ORDER BY created_at DESC',
    [req.params.id]
  );
  res.json(rows);
});

// Criar vistoria — motorista
app.post('/api/vistorias', verifyToken, async (req, res) => {
  try {
    const d = req.body;
    if (!d || !d.formType) return res.status(400).json({ ok: false, error: 'Dados inválidos' });

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

    // Usa motorista_id do token se disponível, senão resolve pelo nome
    let motoristaBd = req.user?.motorista_id || null;
    if (!motoristaBd && d.motorista) {
      const mq = await dbQuery(
        'SELECT id FROM motoristas WHERE LOWER(nome) = LOWER($1) LIMIT 1', [d.motorista]);
      if (mq.rows.length) motoristaBd = mq.rows[0].id;
    }

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

    if (motoristaBd) {
      await dbQuery(
        'UPDATE motoristas SET vistorias_count = vistorias_count + 1 WHERE id = $1',
        [motoristaBd]
      );
    }

    const stopsForReport = d.stops ? [...d.stops].slice(0, 4) : [];
    while (stopsForReport.length < 4) {
      stopsForReport.push({ motivo: '', local: '', items: {}, comentarios: '', pulada: true });
    }
    const vistoriaData = { ...d, stops: stopsForReport };

    const docxPath = path.join(RELAT_DIR, `${base}.docx`);
    const wordBuf  = await gerarWord(vistoriaData);
    fs.writeFileSync(docxPath, wordBuf);

    let pdfOk = false;
    try {
      const pdfPath = path.join(RELAT_DIR, `${base}.pdf`);
      const pdfBuf  = await gerarPdf(vistoriaData);
      fs.writeFileSync(pdfPath, pdfBuf);
      pdfOk = true;
      console.log(`[PDF] Gerado: ${base}.pdf`);
    } catch (pdfErr) {
      console.error('[PDF] Falha ao gerar PDF:', pdfErr.message);
    }

    const savedId = (rows && rows.length) ? rows[0].id : null;
    console.log(`[VISTORIA] Salva: id=${savedId} motorista="${d.motorista}" tipo=${d.formType}`);
    res.json({
      ok: true,
      id:           savedId,
      wordUrl:      `/relatorios/${base}.docx`,
      wordFilename: `${base}.docx`,
      pdfUrl:       pdfOk ? `/relatorios/${base}.pdf` : null,
      pdfFilename:  pdfOk ? `${base}.pdf` : null,
    });
  } catch (err) {
    console.error('[ERRO] POST /api/vistorias:', err.stack || err);
    res.status(500).json({ ok: false, error: err.message + ' | ' + (err.stack || '').split('\n')[1] });
  }
});

// Aprovar / reprovar — gestor
app.patch('/api/vistorias/:id/status', verifyToken, requireGestor, async (req, res) => {
  const { status, obs } = req.body;
  const { rows } = await dbQuery(
    `UPDATE vistorias SET status=$1, approved=$2, obs_gestor=COALESCE($3, obs_gestor)
     WHERE id=$4 RETURNING *`,
    [status, status === 'approved', obs || null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
  res.json(rows[0]);
});

// Editar vistoria com motivo obrigatório — gestor
app.patch('/api/vistorias/:id/editar', verifyToken, requireGestor, async (req, res) => {
  try {
    const { motivo, ...changes } = req.body;
    if (!motivo || !motivo.trim()) {
      return res.status(400).json({ error: 'Motivo da alteração é obrigatório' });
    }

    const curr = await dbQuery('SELECT * FROM vistorias WHERE id=$1', [req.params.id]);
    if (!curr.rows.length) return res.status(404).json({ error: 'Vistoria não encontrada' });
    const antes = curr.rows[0];

    // Campos que o gestor pode editar
    const camposPermitidos = ['obs_gestor', 'status', 'obs', 'processo', 'responsavel',
                              'local_coleta', 'destino', 'lacre_armador', 'lacre_mc', 'lacre_exportador'];
    const updates = Object.entries(changes).filter(([k]) => camposPermitidos.includes(k));
    if (!updates.length) return res.status(400).json({ error: 'Nenhum campo válido para alterar' });

    const setClauses = updates.map(([k], i) => `${k}=$${i + 1}`).join(', ');
    const valores    = updates.map(([, v]) => v);
    valores.push(req.params.id);

    const { rows } = await dbQuery(
      `UPDATE vistorias SET ${setClauses} WHERE id=$${valores.length} RETURNING *`,
      valores
    );

    // Registra o histórico da alteração
    const dadosAnt = {}, dadosNov = {};
    updates.forEach(([k, v]) => { dadosAnt[k] = antes[k]; dadosNov[k] = v; });

    await dbQuery(
      `INSERT INTO vistoria_alteracoes (vistoria_id, gestor_id, gestor_nome, motivo, dados_anteriores, dados_novos)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.params.id, req.user.id, req.user.nome, motivo.trim(),
       JSON.stringify(dadosAnt), JSON.stringify(dadosNov)]
    );

    console.log(`[EDITAR] Vistoria ${req.params.id} alterada por ${req.user.nome} — motivo: ${motivo.trim()}`);
    res.json(rows[0]);
  } catch (err) {
    console.error('[ERRO] PATCH /api/vistorias/:id/editar:', err.message);
    res.status(500).json({ error: err.message });
  }
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
