'use strict';
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign, ImageRun
} = require('docx');
const fs   = require('fs');
const path = require('path');

/* ──────────────────────────────────────────────
   CONFIGURAÇÃO DOS FORMULÁRIOS (espelha o front)
────────────────────────────────────────────── */
const FORMS = {
  rmc045: {
    titulo: 'CHECKLIST DE SEGURANÇA — TRANSPORTE RODOVIÁRIO',
    codigo: 'RMC-045-CL-TR-SC-R05',
    respLabel: 'Nome Completo do Responsável pela Inspeção',
    pontos: [
      'Para-Choques',
      'Motor / Filtro de Ar',
      'Pneus / Aros',
      'Piso da Cabine',
      'Tanque de ar / Combustível',
      'Caixas de Ferramentas / Travamentos',
      'Tanque de Transmissão',
      'Área da Quinta Roda',
      'Parte Externa / Chassis / Embaixo da Carroceria',
      'Interior / Piso da Carroceria',
      'Portas (Interno/Externo) e Sistema de Travamento',
      'Paredes Laterais da Carroceria',
      'Teto Interior / Exterior / Capota',
      'Parede Dianteira',
      'Unidade de Refrigeração',
      'Escapamento / Caixa da Bateria',
      'Cabine / Compartimentos Internos',
      'Verificação integridade do Lacre Armador — V.V.T.T.',
      'Verificação integridade do Lacre MC Transportes — V.V.T.T.',
      'Verificação da integridade do Lacre do Exportador — V.V.T.T.',
      'Verificar ausência de pragas visíveis'
    ]
  },
  rmc046: {
    titulo: 'CHECKLIST DE SEGURANÇA — CONTAINERES EM FCL',
    codigo: 'RMC-046-CL-CONTAINERES-EM-FCL-SC-R05',
    respLabel: 'Nome Completo do Responsável pela Inspeção',
    pontos: [
      'Verificar o Chassis / Parte Externa',
      'Portas — Lados Interno e Externo, e integridade dos mecanismos de travamento',
      'Lateral Direita (interno e externo)',
      'Lateral Esquerda (interno e externo)',
      'Parede Frontal',
      'Teto na parte interna (utilize pedaço de madeira para bater)',
      'Piso interno',
      'Parede de Fundo (verificar a profundidade)',
      'Carcaça do Ventilador (Sistema de Refrigeração)',
      'Verificação integridade do Lacre MC Transporte — V.V.T.T.',
      'Verificar ausência de pragas visíveis'
    ]
  }
};

/* ──────────────────────────────────────────────
   CONSTANTES DE LAYOUT (A4 portrait, margens 1")
────────────────────────────────────────────── */
const PW   = 9026;  // content width in DXA
const MARG = 1440;  // 1 inch margin

/* ──────────────────────────────────────────────
   CORES
────────────────────────────────────────────── */
const C = {
  headerBg:   '1e3a5f',
  headerFg:   'FFFFFF',
  subHdrBg:   'dbeafe',
  subHdrFg:   '1e3a5f',
  labelBg:    'f3f4f6',
  labelFg:    '374151',
  greenBg:    'd1fae5',
  greenFg:    '065f46',
  redBg:      'fee2e2',
  redFg:      '991b1b',
  grayBg:     'f3f4f6',
  grayFg:     '6b7280',
  noticeBg:   'fffbeb',
  white:      'FFFFFF',
  bodyFg:     '111827',
  mutedFg:    '6b7280',
};

/* ──────────────────────────────────────────────
   HELPERS DE BORDA
────────────────────────────────────────────── */
const thinB  = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const thickB = { style: BorderStyle.SINGLE, size: 4, color: C.headerBg };
const noneB  = { style: BorderStyle.NIL, size: 0, color: 'FFFFFF' };
const borders     = { top: thinB, bottom: thinB, left: thinB, right: thinB };
const outerBorder = { top: thickB, bottom: thickB, left: thickB, right: thickB };
const noBorders   = { top: noneB, bottom: noneB, left: noneB, right: noneB };

/* ──────────────────────────────────────────────
   HELPERS DE CONSTRUÇÃO
────────────────────────────────────────────── */
function txt(text, opts = {}) {
  return new TextRun({
    text: text || '',
    font: 'Arial',
    size: opts.size || 18,
    bold: opts.bold || false,
    italic: opts.italic || false,
    color: opts.color || C.bodyFg
  });
}

function para(runs, opts = {}) {
  const children = Array.isArray(runs) ? runs : [txt(runs, opts)];
  return new Paragraph({
    alignment: opts.align || AlignmentType.LEFT,
    spacing: { before: opts.before || 0, after: opts.after || 0 },
    children
  });
}

function tcell(content, width, opts = {}) {
  const children = typeof content === 'string'
    ? [para([txt(content, { size: opts.size || 18, bold: opts.bold, color: opts.color || C.bodyFg })], { align: opts.align || AlignmentType.LEFT })]
    : content;
  return new TableCell({
    borders: opts.borders !== undefined ? opts.borders : borders,
    width:   { size: width, type: WidthType.DXA },
    shading: { fill: opts.bg || C.white, type: ShadingType.CLEAR },
    verticalAlign: opts.va || VerticalAlign.CENTER,
    columnSpan: opts.span || 1,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children
  });
}

function headerCell(text, width, opts = {}) {
  return tcell(text, width, {
    bg:    opts.bg || C.headerBg,
    color: opts.color || C.headerFg,
    bold:  true,
    size:  opts.size || 18,
    align: AlignmentType.CENTER,
    span:  opts.span || 1,
    va:    VerticalAlign.CENTER
  });
}

function labelCell(text, width) {
  return tcell(text, width, { bg: C.labelBg, color: C.labelFg, bold: true, size: 17 });
}

function valueCell(text, width, opts = {}) {
  return tcell(text || '—', width, { size: 18, ...opts });
}

function statusCell(val, width) {
  if (!val) return tcell('', width, { bg: C.white, align: AlignmentType.CENTER });
  const map = {
    A:  { bg: C.greenBg, color: C.greenFg, text: '✓' },
    R:  { bg: C.redBg,   color: C.redFg,   text: '✗' },
    NA: { bg: C.grayBg,  color: C.grayFg,  text: '—' }
  };
  const m = map[val] || { bg: C.white, color: C.bodyFg, text: val };
  return tcell(m.text, width, { bg: m.bg, color: m.color, align: AlignmentType.CENTER, bold: val === 'R', size: 17 });
}

/* ──────────────────────────────────────────────
   FUNÇÃO PRINCIPAL
────────────────────────────────────────────── */
async function gerarWord(vistoria) {
  const cfg = FORMS[vistoria.formType];
  if (!cfg) throw new Error('Tipo de formulário inválido: ' + vistoria.formType);

  /* ── Logo ── */
  let logoRun = null;
  try {
    const logoPath = path.join(__dirname, 'logomctransportes.png');
    if (fs.existsSync(logoPath)) {
      logoRun = new ImageRun({
        type: 'png',
        data: fs.readFileSync(logoPath),
        transformation: { width: 130, height: 44 },
        altText: { title: 'Logo', description: 'MC Transportes', name: 'logo' }
      });
    }
  } catch (_) {}

  /* ── Larguras de coluna ── */
  // Tabela de identificação
  const ID_LABEL = 3200;
  const ID_VALUE = PW - ID_LABEL; // 5826

  // Tabela de paradas (5 cols)
  const PAR_TIPO  = 1840;
  const PAR_STOP  = Math.floor((PW - PAR_TIPO) / 4); // 1796
  // ajuste para fechar exato
  const PAR_LAST  = PW - PAR_TIPO - PAR_STOP * 3;    // 1798

  // Tabela de inspeção (1 label + 4×3 status = 13 cols)
  const IP_LABEL  = 3626;
  const IP_STATUS = Math.floor((PW - IP_LABEL) / 12); // 450 → 12×450=5400, label=3626 → 9026 ✓

  /* ── Tabela de Identificação ── */
  const identRows = [
    ['Transportadora',          'MC TRANSPORTES'],
    ['CNPJ',                    '19.326.067/0001-49'],
    ['Registro ANTT',           '50582811'],
    ['N° do Processo',          vistoria.processo],
    [cfg.respLabel,             vistoria.responsavel],
    ['Nome do Motorista',       vistoria.motorista],
    ['CPF do Motorista',        vistoria.cpf],
    ['Placa do Veículo',        vistoria.placaVeiculo],
    ['Placa da Carreta',        vistoria.placaCarreta || 'Não informado'],
    ['Local da Coleta da Carga', vistoria.localColeta],
    ['Destino da Carga',         vistoria.destino],
  ];
  if (vistoria.formType === 'rmc046') {
    identRows.push(
      ['N° do Container', vistoria.numContainer],
      ['Tara (kg)',        vistoria.tara],
      ['Max. Gross (kg)',  vistoria.maxGross],
    );
  }
  if (vistoria.formType === 'rmc046') {
    // Container em FCL — apenas o lacre da MC Transportes
    identRows.push(['Lacre — MC Transportes', vistoria.lacreMC || 'Não informado']);
  } else {
    identRows.push(
      ['Lacre — Armador',           vistoria.lacreArmador || 'Não informado'],
      ['Lacre — MC Transportes',    vistoria.lacreMC      || 'Não informado'],
      ['Lacre — Exportador',        vistoria.lacreExportador || 'Não informado'],
    );
  }

  const identTable = new Table({
    width: { size: PW, type: WidthType.DXA },
    columnWidths: [ID_LABEL, ID_VALUE],
    rows: identRows.map(([label, value]) => new TableRow({
      children: [labelCell(label, ID_LABEL), valueCell(value, ID_VALUE)]
    }))
  });

  /* ── Tabela de Paradas ── */
  const stops = vistoria.stops; // sempre 4

  const paradasTable = new Table({
    width: { size: PW, type: WidthType.DXA },
    columnWidths: [PAR_TIPO, PAR_STOP, PAR_STOP, PAR_STOP, PAR_LAST],
    rows: [
      new TableRow({ children: [
        headerCell('',         PAR_TIPO),
        headerCell('Partida',  PAR_STOP),
        headerCell('1ª Parada', PAR_STOP),
        headerCell('2ª Parada', PAR_STOP),
        headerCell('3ª Parada', PAR_LAST),
      ]}),
      new TableRow({ children: [
        labelCell('Motivo', PAR_TIPO),
        ...stops.map((s, i) => valueCell(
          s.pulada ? '— (Pulada)' : (s.motivo || ''),
          i === 3 ? PAR_LAST : PAR_STOP,
          { size: 17 }
        ))
      ]}),
      new TableRow({ children: [
        labelCell('Local', PAR_TIPO),
        ...stops.map((s, i) => valueCell(
          s.pulada ? '—' : (s.local || ''),
          i === 3 ? PAR_LAST : PAR_STOP,
          { size: 17 }
        ))
      ]}),
      new TableRow({ children: [
        labelCell('Comentários / Observações', PAR_TIPO),
        ...stops.map((s, i) => valueCell(
          s.pulada ? '—' : (s.comentarios || ''),
          i === 3 ? PAR_LAST : PAR_STOP,
          { size: 17, va: VerticalAlign.TOP }
        ))
      ]}),
    ]
  });

  /* ── Tabela de Pontos de Verificação ── */
  const ipColWidths = [IP_LABEL, ...Array(12).fill(IP_STATUS)];

  const stopHeaderRow = new TableRow({
    tableHeader: true,
    children: [
      headerCell('PONTOS DE VERIFICAÇÃO', IP_LABEL, { size: 16 }),
      headerCell('PARTIDA',   IP_STATUS * 3, { span: 3, size: 15 }),
      headerCell('1ª PARADA', IP_STATUS * 3, { span: 3, size: 15 }),
      headerCell('2ª PARADA', IP_STATUS * 3, { span: 3, size: 15 }),
      headerCell('3ª PARADA', IP_STATUS * 3, { span: 3, size: 15 }),
    ]
  });

  const arnaHeaderRow = new TableRow({
    tableHeader: true,
    children: [
      headerCell('', IP_LABEL, { bg: C.subHdrBg, color: C.subHdrFg }),
      ...Array(4).fill(null).flatMap(() => [
        headerCell('A',  IP_STATUS, { bg: C.subHdrBg, color: C.subHdrFg, size: 15 }),
        headerCell('R',  IP_STATUS, { bg: C.subHdrBg, color: C.subHdrFg, size: 15 }),
        headerCell('NA', IP_STATUS, { bg: C.subHdrBg, color: C.subHdrFg, size: 15 }),
      ])
    ]
  });

  const ipDataRows = cfg.pontos.map((label, idx) => {
    const num   = idx + 1;
    const rowBg = idx % 2 === 0 ? 'FAFAFA' : C.white;

    return new TableRow({
      children: [
        tcell(`${num}. ${label}`, IP_LABEL, { bg: rowBg, size: 16 }),
        ...stops.flatMap(s => {
          if (s.pulada) {
            return [
              tcell('', IP_STATUS, { bg: C.grayBg }),
              tcell('', IP_STATUS, { bg: C.grayBg }),
              tcell('', IP_STATUS, { bg: C.grayBg }),
            ];
          }
          const v = (s.items || {})[num] || (s.items || {})[String(num)] || '';
          return [
            statusCell(v === 'A'  ? 'A'  : '', IP_STATUS),
            statusCell(v === 'R'  ? 'R'  : '', IP_STATUS),
            statusCell(v === 'NA' ? 'NA' : '', IP_STATUS),
          ];
        })
      ]
    });
  });

  // Legenda row (span 13)
  const legendaRow = new TableRow({
    children: [
      new TableCell({
        borders,
        width:  { size: PW, type: WidthType.DXA },
        columnSpan: 13,
        shading: { fill: C.noticeBg, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({
          children: [
            txt('Legenda:  ', { bold: true, size: 16 }),
            txt('✓ A = Aprovado     ', { size: 16, color: C.greenFg }),
            txt('✗ R = Reprovado     ', { size: 16, color: C.redFg }),
            txt('— NA = Não Aplicável', { size: 16, color: C.grayFg }),
          ]
        })]
      })
    ]
  });

  const ipTable = new Table({
    width: { size: PW, type: WidthType.DXA },
    columnWidths: ipColWidths,
    rows: [stopHeaderRow, arnaHeaderRow, ...ipDataRows, legendaRow]
  });

  /* ── Tabela de Assinatura ── */
  const SIG1 = 4514, SIG2 = 2256, SIG3 = PW - SIG1 - SIG2;
  const sigTable = new Table({
    width: { size: PW, type: WidthType.DXA },
    columnWidths: [SIG1, SIG2, SIG3],
    rows: [
      new TableRow({ children: [
        labelCell('Responsável pela Inspeção', SIG1),
        labelCell('Data da Inspeção',           SIG2),
        labelCell('Hora da Inspeção',           SIG3),
      ]}),
      new TableRow({ children: [
        valueCell(vistoria.responsavel || '',   SIG1),
        valueCell(vistoria.dataInspecao || '',  SIG2, { align: AlignmentType.CENTER }),
        valueCell(vistoria.horaInspecao || '',  SIG3, { align: AlignmentType.CENTER }),
      ]}),
    ]
  });

  /* ── Monta o documento ── */
  const titleParas = [
    // Linha com logo + título lado a lado
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [
        ...(logoRun ? [logoRun, txt('   ', { size: 20 })] : []),
        txt(cfg.titulo, { size: 24, bold: true, color: C.headerBg }),
      ]
    }),
    para([txt(cfg.codigo, { size: 16, color: C.mutedFg })], { align: AlignmentType.CENTER, after: 120 }),
    para([
      txt(
        'O Motorista / Operacional deve garantir a Segurança dos meios de Transporte quando ' +
        'deixados sem supervisão do motorista e verificar se há violações de Segurança no retorno. ' +
        'No caso de violação ou suspeita de violação, é importante que o Motorista comunique ' +
        'imediatamente o Operacional, que deve analisar a necessidade de iniciar os fluxos de ' +
        'comunicação entre parceiros e autoridades, conforme os procedimentos internos.',
        { size: 16, italic: true, color: C.labelFg }
      )
    ], { after: 200 }),
  ];

  const sectionTitle = (text) =>
    para([txt(text, { size: 20, bold: true, color: C.headerBg })], { before: 200, after: 100 });

  const notasParas = [
    sectionTitle('NOTAS E REFERÊNCIAS'),
    para([
      txt('Metodologia V.V.T.T. (verificação de lacres de alta segurança): ', { bold: true, size: 16 }),
      txt('V — Visualizar o lacre e os mecanismos de travamento, garantindo integridade; ', { size: 16 }),
      txt('V — Verificar o número do lacre em relação aos documentos de remessa; ', { size: 16 }),
      txt('T — Tracionar / puxar o lacre para garantir que está afixado corretamente; ', { size: 16 }),
      txt('T — Torcer e girar o lacre para garantir que seus componentes não se desparafusem ou separem.', { size: 16 }),
    ], { after: 80 }),
    para([
      txt('Pragas visíveis: ', { bold: true, size: 16 }),
      txt(
        'Insetos, animais, invertebrados vivos ou mortos, casulos, osso, sangue, cabelos, carne, ' +
        'secreções ou excreções. Sementes, frutas, galhos, folhas, cascas, raízes, terra ou água ' +
        'que não seja da carga manifestada.',
        { size: 16 }
      ),
    ], { after: 80 }),
  ];

  const obsParas = vistoria.obs ? [
    sectionTitle('OBSERVAÇÕES FINAIS'),
    para(vistoria.obs, { after: 120 }),
  ] : [];

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size:   { width: 11906, height: 16838 },
          margin: { top: MARG, right: MARG, bottom: MARG, left: MARG }
        }
      },
      children: [
        ...titleParas,
        sectionTitle('IDENTIFICAÇÃO'),
        identTable,
        sectionTitle('REGISTRO DE PARADAS'),
        paradasTable,
        sectionTitle('PONTOS DE VERIFICAÇÃO'),
        ipTable,
        ...notasParas,
        ...obsParas,
        sectionTitle('ASSINATURA / RESPONSÁVEL'),
        sigTable,
        para([
          txt(
            `Fim de viagem — ${vistoria.responsavel || ''} · ${vistoria.dataInspecao || ''} · ${vistoria.horaInspecao || ''}`,
            { size: 15, italic: true, color: C.mutedFg }
          )
        ], { align: AlignmentType.CENTER, before: 200 }),
      ]
    }]
  });

  return Packer.toBuffer(doc);
}

module.exports = { gerarWord };
