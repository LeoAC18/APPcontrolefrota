'use strict';
const PDFDocument = require('pdfkit');
const fs   = require('fs');
const path = require('path');

/* ── Configuração dos formulários ── */
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
      'Area da Quinta Roda',
      'Parte Externa / Chassis / Embaixo da Carroceria',
      'Interior / Piso da Carroceria',
      'Portas (Interno/Externo) e Sistema de Travamento',
      'Paredes Laterais da Carroceria',
      'Teto Interior / Exterior / Capota',
      'Parede Dianteira',
      'Unidade de Refrigeracao',
      'Escapamento / Caixa da Bateria',
      'Cabine / Compartimentos Internos',
      'Verificacao integridade do Lacre Armador - V.V.T.T.',
      'Verificacao integridade do Lacre MC Transportes - V.V.T.T.',
      'Verificacao da integridade do Lacre do Exportador - V.V.T.T.',
      'Verificar ausencia de pragas visiveis'
    ]
  },
  rmc046: {
    titulo: 'CHECKLIST DE SEGURANÇA — CONTAINERES EM FCL',
    codigo: 'RMC-046-CL-CONTAINERES-EM-FCL-SC-R05',
    respLabel: 'Nome Completo do Responsável pela Inspeção',
    pontos: [
      'Verificar o Chassis / Parte Externa',
      'Portas - Lados Interno e Externo, e integridade dos mecanismos de travamento',
      'Lateral Direita (interno e externo)',
      'Lateral Esquerda (interno e externo)',
      'Parede Frontal',
      'Teto na parte interna (utilize pedaco de madeira para bater)',
      'Piso interno',
      'Parede de Fundo (verificar a profundidade)',
      'Carcaca do Ventilador (Sistema de Refrigeracao)',
      'Verificacao integridade do Lacre MC Transporte - V.V.T.T.',
      'Verificar ausencia de pragas visiveis'
    ]
  }
};

/* ── Cores ── */
const C = {
  headerBg: '#1e3a5f',
  headerFg: '#FFFFFF',
  subHdrBg: '#dbeafe',
  subHdrFg: '#1e3a5f',
  labelBg:  '#f3f4f6',
  labelFg:  '#374151',
  greenBg:  '#d1fae5',
  greenFg:  '#065f46',
  redBg:    '#fee2e2',
  redFg:    '#991b1b',
  grayBg:   '#e5e7eb',
  grayFg:   '#6b7280',
  noticeBg: '#fffbeb',
  white:    '#FFFFFF',
  bodyFg:   '#111827',
  mutedFg:  '#6b7280',
  border:   '#CCCCCC',
};

const MARGIN  = 50;
const PAGE_W  = 595.28;
const PAGE_H  = 841.89;
const CW      = PAGE_W - MARGIN * 2;   // ~495 pts

async function gerarPdf(vistoria) {
  const cfg = FORMS[vistoria.formType];
  if (!cfg) throw new Error('Tipo de formulario invalido: ' + vistoria.formType);

  const stops = vistoria.stops ? [...vistoria.stops].slice(0, 4) : [];
  while (stops.length < 4) {
    stops.push({ motivo: '', local: '', items: {}, comentarios: '', pulada: true });
  }

  return new Promise((resolve, reject) => {
    const doc  = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true, bufferPages: true });
    const bufs = [];
    doc.on('data', b => bufs.push(b));
    doc.on('end',  () => resolve(Buffer.concat(bufs)));
    doc.on('error', reject);

    let Y = MARGIN;

    function newPage() { doc.addPage(); Y = MARGIN; }
    function check(h)  { if (Y + h > PAGE_H - MARGIN) newPage(); }

    /* Draws a single table cell: background + border + text */
    function cell(x, y, w, h, text, opts = {}) {
      const bg    = opts.bg    || C.white;
      const fg    = opts.fg    || C.bodyFg;
      const size  = opts.size  || 8;
      const bold  = opts.bold  || false;
      const align = opts.align || 'left';
      const pad   = 3;

      doc.rect(x, y, w, h).fill(bg);
      doc.rect(x, y, w, h).stroke(C.border);

      const str = text != null ? String(text) : '';
      if (str.trim()) {
        doc
          .font(bold ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(size)
          .fillColor(fg)
          .text(str, x + pad, y + pad + 1, {
            width:     w - pad * 2,
            height:    h - pad * 2 - 1,
            align,
            lineBreak: true,
          });
      }
    }

    function hCell(x, y, w, h, text, opts = {}) {
      cell(x, y, w, h, text, { bg: C.headerBg, fg: C.headerFg, bold: true, align: 'center', size: 8, ...opts });
    }

    function lCell(x, y, w, h, text) {
      cell(x, y, w, h, text, { bg: C.labelBg, fg: C.labelFg, bold: true, size: 8 });
    }

    function sectionTitle(text) {
      check(18);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(C.headerBg)
         .text(text, MARGIN, Y + 4, { width: CW });
      Y += 18;
    }

    /* ── CABEÇALHO ─────────────────────────────────────────────────── */
    const logoPath = path.join(__dirname, 'logomctransportes.png');
    if (fs.existsSync(logoPath)) {
      try { doc.image(logoPath, MARGIN, Y, { height: 34 }); } catch (_) {}
    }

    doc.font('Helvetica-Bold').fontSize(12).fillColor(C.headerBg)
       .text(cfg.titulo, MARGIN, Y + 8, { width: CW, align: 'center' });
    Y += 40;

    doc.font('Helvetica').fontSize(8).fillColor(C.mutedFg)
       .text(cfg.codigo, MARGIN, Y, { width: CW, align: 'center' });
    Y += 13;

    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(C.labelFg)
       .text(
         'O Motorista / Operacional deve garantir a Seguranca dos meios de Transporte quando ' +
         'deixados sem supervisao do motorista e verificar se ha violacoes de Seguranca no retorno. ' +
         'No caso de violacao ou suspeita de violacao, comunique imediatamente o Operacional.',
         MARGIN, Y, { width: CW }
       );
    Y = doc.y + 8;

    /* ── IDENTIFICAÇÃO ──────────────────────────────────────────────── */
    sectionTitle('IDENTIFICACAO');

    const ID_L = 175;
    const ID_V = CW - ID_L;
    const ID_H = 17;

    const identRows = [
      ['Transportadora',            'MC TRANSPORTES'],
      ['CNPJ',                      '19.326.067/0001-49'],
      ['Registro ANTT',             '50582811'],
      ['N do Processo',             vistoria.processo    || '-'],
      [cfg.respLabel,               vistoria.responsavel || '-'],
      ['Nome do Motorista',         vistoria.motorista   || '-'],
      ['CPF do Motorista',          vistoria.cpf         || '-'],
      ['Placa do Veiculo',          vistoria.placaVeiculo  || '-'],
      ['Placa da Carreta',          vistoria.placaCarreta  || 'Nao informado'],
      ['Local da Coleta da Carga',  vistoria.localColeta   || '-'],
      ['Destino da Carga',          vistoria.destino       || '-'],
    ];
    if (vistoria.formType === 'rmc046') {
      identRows.push(
        ['N do Container', vistoria.numContainer || '-'],
        ['Tara (kg)',      vistoria.tara     ? String(vistoria.tara)     : '-'],
        ['Max. Gross (kg)', vistoria.maxGross ? String(vistoria.maxGross) : '-'],
      );
    }
    if (vistoria.formType === 'rmc046') {
      // Container em FCL — apenas o lacre da MC Transportes
      identRows.push(['Lacre - MC Transportes', vistoria.lacreMC || 'Nao informado']);
    } else {
      identRows.push(
        ['Lacre - Armador',          vistoria.lacreArmador    || 'Nao informado'],
        ['Lacre - MC Transportes',   vistoria.lacreMC         || 'Nao informado'],
        ['Lacre - Exportador',       vistoria.lacreExportador || 'Nao informado'],
      );
    }

    for (const [lbl, val] of identRows) {
      check(ID_H);
      lCell(MARGIN,        Y, ID_L, ID_H, lbl);
      cell (MARGIN + ID_L, Y, ID_V, ID_H, val, { size: 8 });
      Y += ID_H;
    }

    /* ── REGISTRO DE PARADAS ────────────────────────────────────────── */
    Y += 6;
    sectionTitle('REGISTRO DE PARADAS');

    const PAR_TIPO = 118;
    const PAR_W    = Math.floor((CW - PAR_TIPO) / 4);
    const PAR_LAST = CW - PAR_TIPO - PAR_W * 3;
    const PAR_HH   = 15;
    const PAR_DH   = 20;
    const stopLabels = ['Partida', '1a Parada', '2a Parada', '3a Parada'];
    const stopWidths = [PAR_W, PAR_W, PAR_W, PAR_LAST];

    check(PAR_HH);
    hCell(MARGIN, Y, PAR_TIPO, PAR_HH, '');
    let px = MARGIN + PAR_TIPO;
    for (let i = 0; i < 4; i++) {
      hCell(px, Y, stopWidths[i], PAR_HH, stopLabels[i]);
      px += stopWidths[i];
    }
    Y += PAR_HH;

    const parDataRows = [
      ['Motivo',                    s => s.pulada ? '- (Pulada)' : (s.motivo || '')],
      ['Local',                     s => s.pulada ? '-'          : (s.local  || '')],
      ['Comentarios / Observacoes', s => s.pulada ? '-'          : (s.comentarios || '')],
    ];

    for (const [lbl, fn] of parDataRows) {
      check(PAR_DH);
      lCell(MARGIN, Y, PAR_TIPO, PAR_DH, lbl);
      px = MARGIN + PAR_TIPO;
      for (let i = 0; i < 4; i++) {
        cell(px, Y, stopWidths[i], PAR_DH, fn(stops[i]), { size: 8 });
        px += stopWidths[i];
      }
      Y += PAR_DH;
    }

    /* ── PONTOS DE VERIFICAÇÃO ──────────────────────────────────────── */
    Y += 6;
    sectionTitle('PONTOS DE VERIFICACAO');

    const IP_LABEL = 210;
    const IP_STAT  = Math.floor((CW - IP_LABEL) / 12);
    const IP_EXTRA = CW - IP_LABEL - IP_STAT * 12;
    const IP_HH    = 14;
    const IP_RH    = 20;

    // Row 1: stop group headers
    check(IP_HH);
    hCell(MARGIN, Y, IP_LABEL, IP_HH, 'PONTOS DE VERIFICACAO', { size: 7.5 });
    px = MARGIN + IP_LABEL;
    for (let i = 0; i < 4; i++) {
      const gw = IP_STAT * 3 + (i === 3 ? IP_EXTRA : 0);
      hCell(px, Y, gw, IP_HH, stopLabels[i].toUpperCase(), { size: 7.5 });
      px += gw;
    }
    Y += IP_HH;

    // Row 2: A / R / NA sub-headers
    check(IP_HH);
    cell(MARGIN, Y, IP_LABEL, IP_HH, '', { bg: C.subHdrBg });
    px = MARGIN + IP_LABEL;
    for (let i = 0; i < 4; i++) {
      for (const [sub, isLast] of [['A', false], ['R', false], ['NA', i === 3]]) {
        const w = isLast ? IP_STAT + IP_EXTRA : IP_STAT;
        cell(px, Y, w, IP_HH, sub, { bg: C.subHdrBg, fg: C.subHdrFg, bold: true, align: 'center', size: 7.5 });
        px += w;
      }
    }
    Y += IP_HH;

    // Data rows
    cfg.pontos.forEach((label, idx) => {
      check(IP_RH);
      const rowBg = idx % 2 === 0 ? '#f9fafb' : C.white;
      cell(MARGIN, Y, IP_LABEL, IP_RH, `${idx + 1}. ${label}`, { bg: rowBg, size: 7.5 });
      px = MARGIN + IP_LABEL;
      for (let i = 0; i < 4; i++) {
        const s = stops[i];
        for (const [col, isLast] of [['A', false], ['R', false], ['NA', i === 3]]) {
          const w = isLast ? IP_STAT + IP_EXTRA : IP_STAT;
          if (s.pulada) {
            cell(px, Y, w, IP_RH, '', { bg: C.grayBg });
          } else {
            const v = (s.items || {})[idx + 1] || (s.items || {})[String(idx + 1)] || '';
            let bg = C.white, fg = C.bodyFg, txt = '';
            if (v === col) {
              if (col === 'A')  { bg = C.greenBg; fg = C.greenFg; txt = 'A'; }
              if (col === 'R')  { bg = C.redBg;   fg = C.redFg;   txt = 'R'; }
              if (col === 'NA') { bg = C.grayBg;  fg = C.grayFg;  txt = '-'; }
            }
            cell(px, Y, w, IP_RH, txt, { bg, fg, align: 'center', size: 8, bold: col === 'R' && v === 'R' });
          }
          px += w;
        }
      }
      Y += IP_RH;
    });

    // Legenda
    check(18);
    doc.rect(MARGIN, Y, CW, 18).fill(C.noticeBg);
    doc.rect(MARGIN, Y, CW, 18).stroke(C.border);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.bodyFg)
       .text('Legenda: ', MARGIN + 4, Y + 5, { continued: true });
    doc.font('Helvetica').fillColor(C.greenFg).text('A = Aprovado   ', { continued: true });
    doc.fillColor(C.redFg).text('R = Reprovado   ', { continued: true });
    doc.fillColor(C.grayFg).text('- = Nao Aplicavel');
    Y += 18;

    /* ── NOTAS ──────────────────────────────────────────────────────── */
    Y += 6;
    sectionTitle('NOTAS E REFERENCIAS');

    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.bodyFg)
       .text('Metodologia V.V.T.T. (lacres de alta seguranca): ', MARGIN, Y, { continued: true });
    doc.font('Helvetica')
       .text('V - Visualizar o lacre; V - Verificar o numero do lacre nos documentos; ' +
             'T - Tracionar o lacre para confirmar fixacao; T - Torcer para verificar integridade.', { width: CW });
    Y = doc.y + 4;

    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.bodyFg)
       .text('Pragas visiveis: ', MARGIN, Y, { continued: true });
    doc.font('Helvetica')
       .text('Insetos, animais, invertebrados vivos ou mortos, casulos, osso, sangue, cabelos, carne, ' +
             'secrecoes ou excrecoes. Sementes, frutas, galhos, folhas, cascas, raizes, terra ou agua ' +
             'que nao seja da carga manifestada.', { width: CW });
    Y = doc.y + 6;

    if (vistoria.obs) {
      sectionTitle('OBSERVACOES FINAIS');
      doc.font('Helvetica').fontSize(8).fillColor(C.bodyFg)
         .text(vistoria.obs, MARGIN, Y, { width: CW });
      Y = doc.y + 6;
    }

    /* ── ASSINATURA ─────────────────────────────────────────────────── */
    Y += 4;
    sectionTitle('ASSINATURA / RESPONSAVEL');

    const SIG1 = Math.floor(CW * 0.55);
    const SIG2 = Math.floor(CW * 0.22);
    const SIG3 = CW - SIG1 - SIG2;
    const SIG_H = 17;

    check(SIG_H * 2);
    lCell(MARGIN,           Y, SIG1, SIG_H, 'Responsavel pela Inspecao');
    lCell(MARGIN + SIG1,    Y, SIG2, SIG_H, 'Data da Inspecao');
    lCell(MARGIN+SIG1+SIG2, Y, SIG3, SIG_H, 'Hora da Inspecao');
    Y += SIG_H;

    cell(MARGIN,           Y, SIG1, SIG_H, vistoria.responsavel  || '', { size: 8 });
    cell(MARGIN + SIG1,    Y, SIG2, SIG_H, vistoria.dataInspecao || '', { size: 8, align: 'center' });
    cell(MARGIN+SIG1+SIG2, Y, SIG3, SIG_H, vistoria.horaInspecao || '', { size: 8, align: 'center' });
    Y += SIG_H + 10;

    doc.font('Helvetica-Oblique').fontSize(7).fillColor(C.mutedFg)
       .text(
         `Fim de viagem — ${vistoria.responsavel || ''} · ${vistoria.dataInspecao || ''} · ${vistoria.horaInspecao || ''}`,
         MARGIN, Y, { width: CW, align: 'center' }
       );

    /* ── NUMERAÇÃO DE PÁGINAS (1, 2, 3, ...) ── */
    const range = doc.bufferedPageRange(); // { start, count }
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.font('Helvetica').fontSize(8).fillColor(C.mutedFg)
         .text(`Pagina ${i + 1} de ${range.count}`, MARGIN, PAGE_H - MARGIN + 12,
               { width: CW, align: 'center' });
    }

    doc.end();
  });
}

module.exports = { gerarPdf };
