'use strict';
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { exec } = require('child_process');
const { gerarWord } = require('./gerarRelatorio');

const app  = express();
const PORT = 3000;

app.use(express.json({ limit: '20mb' }));
// www/ é o webDir do Capacitor — serve o app mobile na raiz
app.use(express.static(path.join(__dirname, 'www')));
// Mantém arquivos do projeto raiz (logo, gestor) acessíveis
app.use(express.static(path.join(__dirname)));
app.use('/relatorios', express.static(path.join(__dirname, 'relatorios')));

// Pastas e arquivos de dados
const RELAT_DIR     = path.join(__dirname, 'relatorios');
const DATA_DIR      = path.join(__dirname, 'data');
const MOTOR_FILE    = path.join(DATA_DIR, 'motoristas.json');
const VISTORIA_FILE = path.join(DATA_DIR, 'vistorias.json');

[RELAT_DIR, DATA_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d); });

// Helpers de leitura/gravação JSON
function readJson(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return def; }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Seed inicial de motoristas se arquivo não existir
if (!fs.existsSync(MOTOR_FILE)) {
  writeJson(MOTOR_FILE, [
    { id:1, nome:'Carlos Silva',   cpf:'123.456.789-00', cnh:'12345678', cnhCat:'E', tel:'(11) 99001-1234', admissao:'2021-03-15', veiculo:'ABC-1D23 — Scania R450',     status:'Disponível', vistorias:0, obs:'' },
    { id:2, nome:'José Alves',     cpf:'234.567.890-11', cnh:'23456789', cnhCat:'E', tel:'(11) 98765-4321', admissao:'2019-07-01', veiculo:'DEF-4T56 — Volvo FH 500',   status:'Disponível', vistorias:0, obs:'' },
    { id:3, nome:'Roberto Melo',   cpf:'345.678.901-22', cnh:'34567890', cnhCat:'E', tel:'(31) 97654-3210', admissao:'2022-01-10', veiculo:'XYZ-9K12 — Mercedes Actros', status:'Disponível', vistorias:0, obs:'' },
  ]);
}
if (!fs.existsSync(VISTORIA_FILE)) {
  writeJson(VISTORIA_FILE, []);
}

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
      const cmd = `${candidates[i]} --headless --convert-to pdf --outdir "${outDir}" "${docxPath}"`;
      exec(cmd, { timeout: 30000 }, err => {
        if (err) return tryNext(i + 1);
        const pdfPath = docxPath.replace(/\.docx$/, '.pdf');
        resolve(fs.existsSync(pdfPath) ? pdfPath : null);
      });
    }
    tryNext(0);
  });
}

/* ─────────────────────────────────────────
   MOTORISTAS
───────────────────────────────────────── */
app.get('/api/motoristas', (_req, res) => {
  res.json(readJson(MOTOR_FILE, []));
});

app.post('/api/motoristas', (req, res) => {
  const list = readJson(MOTOR_FILE, []);
  const novo = { id: Date.now(), vistorias: 0, ...req.body };
  list.push(novo);
  writeJson(MOTOR_FILE, list);
  res.json(novo);
});

app.put('/api/motoristas/:id', (req, res) => {
  const id   = Number(req.params.id);
  const list = readJson(MOTOR_FILE, []);
  const idx  = list.findIndex(m => m.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Não encontrado' });
  list[idx] = { ...list[idx], ...req.body, id };
  writeJson(MOTOR_FILE, list);
  res.json(list[idx]);
});

app.delete('/api/motoristas/:id', (req, res) => {
  const id   = Number(req.params.id);
  let list   = readJson(MOTOR_FILE, []);
  list       = list.filter(m => m.id !== id);
  writeJson(MOTOR_FILE, list);
  res.json({ ok: true });
});

/* ─────────────────────────────────────────
   VISTORIAS
───────────────────────────────────────── */
app.get('/api/vistorias', (_req, res) => {
  res.json(readJson(VISTORIA_FILE, []));
});

app.post('/api/vistorias', async (req, res) => {
  try {
    const vistoria = req.body;
    if (!vistoria || !vistoria.formType) {
      return res.status(400).json({ ok: false, error: 'Dados inválidos' });
    }

    // Persiste no arquivo
    const list = readJson(VISTORIA_FILE, []);
    const entry = {
      id:       Date.now(),
      status:   'pending',
      approved: false,
      ...vistoria,
    };
    list.push(entry);
    writeJson(VISTORIA_FILE, list);

    // Incrementa contador de vistorias do motorista
    const motors = readJson(MOTOR_FILE, []);
    const mIdx   = motors.findIndex(m =>
      m.nome.toLowerCase() === (vistoria.motorista || '').toLowerCase()
    );
    if (mIdx !== -1) {
      motors[mIdx].vistorias = (motors[mIdx].vistorias || 0) + 1;
      writeJson(MOTOR_FILE, motors);
    }

    // Gera Word
    const ts        = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const motorNorm = (vistoria.motorista || 'motorista').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
    const base      = `${(vistoria.formType || 'vistoria').toUpperCase()}_${motorNorm}_${ts}`;
    const docxName  = `${base}.docx`;
    const docxPath  = path.join(RELAT_DIR, docxName);

    const buffer = await gerarWord(vistoria);
    fs.writeFileSync(docxPath, buffer);
    console.log(`[OK] Word gerado: ${docxName}`);

    const pdfPath = await convertPdf(docxPath);
    const pdfName = pdfPath ? path.basename(pdfPath) : null;
    if (pdfName) console.log(`[OK] PDF gerado: ${pdfName}`);

    res.json({
      ok:           true,
      id:           entry.id,
      wordUrl:      `/relatorios/${docxName}`,
      wordFilename: docxName,
      pdfUrl:       pdfName ? `/relatorios/${pdfName}` : null,
      pdfFilename:  pdfName || null,
    });
  } catch (err) {
    console.error('[ERRO] POST /api/vistorias:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Aprovar / reprovar vistoria
app.patch('/api/vistorias/:id/status', (req, res) => {
  const id     = Number(req.params.id);
  const list   = readJson(VISTORIA_FILE, []);
  const idx    = list.findIndex(v => v.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Não encontrado' });
  const { status, obs } = req.body; // 'approved' | 'rejected'
  list[idx].status   = status;
  list[idx].approved = status === 'approved';
  if (obs !== undefined) list[idx].obsGestor = obs;
  writeJson(VISTORIA_FILE, list);
  res.json(list[idx]);
});

/* ─────────────────────────────────────────
   Rota legada — mantida por compatibilidade
───────────────────────────────────────── */
app.post('/api/relatorio', async (req, res) => {
  try {
    const vistoria = req.body;
    if (!vistoria || !vistoria.formType) {
      return res.status(400).json({ ok: false, error: 'Dados inválidos' });
    }
    const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const motorista = (vistoria.motorista || 'motorista').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
    const base     = `${vistoria.formType.toUpperCase()}_${motorista}_${ts}`;
    const docxName = `${base}.docx`;
    const docxPath = path.join(RELAT_DIR, docxName);
    const buffer   = await gerarWord(vistoria);
    fs.writeFileSync(docxPath, buffer);
    console.log(`[OK] Word gerado: ${docxName}`);
    const pdfPath  = await convertPdf(docxPath);
    const pdfName  = pdfPath ? path.basename(pdfPath) : null;
    res.json({ ok: true, wordUrl: `/relatorios/${docxName}`, wordFilename: docxName, pdfUrl: pdfName ? `/relatorios/${pdfName}` : null, pdfFilename: pdfName || null });
  } catch (err) {
    console.error('[ERRO] /api/relatorio:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/status', (_req, res) => {
  const vistorias = readJson(VISTORIA_FILE, []);
  const motors    = readJson(MOTOR_FILE, []);
  res.json({
    ok: true,
    message: 'MC Transportes API rodando',
    port: PORT,
    motoristas: motors.length,
    vistorias: vistorias.length,
    pendentes: vistorias.filter(v => v.status === 'pending').length,
  });
});

app.listen(PORT, () => {
  console.log(`\n✅ MC Transportes App`);
  console.log(`   → App motorista: http://localhost:${PORT}`);
  console.log(`   → Painel gestor: http://localhost:${PORT}/gestor`);
  console.log(`   → API status:    http://localhost:${PORT}/api/status`);
  console.log(`   → Dados em:      ${DATA_DIR}\n`);
});
