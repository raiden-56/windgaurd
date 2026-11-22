import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import PDFDocument from 'pdfkit';

export interface Column {
  key: string;
  label: string;
  /** Relative width weight (PDF) / character width (Excel). */
  width?: number;
  align?: 'left' | 'right' | 'center';
}

export interface Section {
  name: string;
  columns: Column[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
  /** Optional colour per cell value (e.g. status abbreviations in a muster grid). */
  cellColors?: Record<string, string>;
  compact?: boolean;
}

export interface ReportDoc {
  title: string;
  fileName: string;
  meta: { label: string; value: string }[];
  sections: Section[];
  /** Signature lines printed at the end of PDFs (official register format). */
  signatures?: string[];
  landscape?: boolean;
}

const NAVY = '#111C2D';
const BORDER = '#D5DBE3';

function str(v: unknown) {
  if (v === null || v === undefined) return '';
  return String(v);
}

@Injectable()
export class ExportService {
  async send(res: Response, doc: ReportDoc, format: 'xlsx' | 'csv' | 'pdf') {
    const safe = doc.fileName.replace(/[^\w.-]+/g, '_');
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safe}.csv"`);
      res.send('﻿' + this.csv(doc));
      return;
    }
    if (format === 'xlsx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${safe}.xlsx"`);
      const wb = this.xlsx(doc);
      await wb.xlsx.write(res);
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.pdf"`);
    this.pdf(doc, res);
  }

  csv(doc: ReportDoc) {
    const esc = (v: unknown) => {
      const s = str(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines: string[] = [esc(doc.title), ...doc.meta.map((m) => `${esc(m.label)},${esc(m.value)}`), ''];
    for (const s of doc.sections) {
      if (doc.sections.length > 1) lines.push(esc(s.name));
      lines.push(s.columns.map((c) => esc(c.label)).join(','));
      for (const r of s.rows) lines.push(s.columns.map((c) => esc(r[c.key])).join(','));
      if (s.totals) lines.push(s.columns.map((c) => esc(s.totals![c.key])).join(','));
      lines.push('');
    }
    return lines.join('\r\n');
  }

  xlsx(doc: ReportDoc) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'WINDGUARD';
    wb.created = new Date();
    for (const s of doc.sections) {
      const ws = wb.addWorksheet(s.name.slice(0, 31), {
        pageSetup: { orientation: doc.landscape ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
      });
      const colCount = s.columns.length;
      ws.mergeCells(1, 1, 1, Math.max(colCount, 4));
      const title = ws.getCell(1, 1);
      title.value = doc.title;
      title.font = { bold: true, size: 14, color: { argb: 'FF111C2D' } };
      let r = 2;
      for (const m of doc.meta) {
        ws.getCell(r, 1).value = m.label;
        ws.getCell(r, 1).font = { bold: true, color: { argb: 'FF475569' } };
        ws.mergeCells(r, 2, r, Math.max(colCount, 4));
        ws.getCell(r, 2).value = m.value;
        r++;
      }
      r++;
      const headerRow = ws.getRow(r);
      s.columns.forEach((c, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = c.label;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: s.compact ? 9 : 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111C2D' } };
        cell.alignment = { horizontal: c.align ?? 'left', vertical: 'middle', wrapText: true };
        ws.getColumn(i + 1).width = c.width ?? Math.max(10, c.label.length + 2);
      });
      headerRow.height = 22;
      ws.views = [{ state: 'frozen', ySplit: r, xSplit: s.compact ? 3 : 0 }];
      const border = { style: 'thin' as const, color: { argb: 'FFD5DBE3' } };
      const addRow = (data: Record<string, unknown>, bold = false) => {
        r++;
        const row = ws.getRow(r);
        s.columns.forEach((c, i) => {
          const cell = row.getCell(i + 1);
          const v = data[c.key];
          cell.value = typeof v === 'number' ? v : str(v);
          cell.alignment = { horizontal: c.align ?? 'left' };
          cell.border = { top: border, bottom: border, left: border, right: border };
          if (bold) cell.font = { bold: true };
          if (s.compact) cell.font = { ...(cell.font ?? {}), size: 9 };
          const color = s.cellColors?.[str(v)];
          if (color && !bold) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + color.replace('#', '') } };
        });
      };
      for (const row of s.rows) addRow(row);
      if (s.totals) addRow(s.totals, true);
      if (doc.signatures?.length) {
        r += 2;
        doc.signatures.forEach((sig, i) => {
          ws.getCell(r, 1 + i * 4).value = `${sig}: ____________________`;
        });
      }
    }
    return wb;
  }

  pdf(doc: ReportDoc, out: NodeJS.WritableStream) {
    const pdf = new PDFDocument({ size: 'A4', layout: doc.landscape ? 'landscape' : 'portrait', margin: 32, bufferPages: true, info: { Title: doc.title, Creator: 'WINDGUARD' } });
    pdf.pipe(out);
    const left = pdf.page.margins.left;
    const width = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
    const bottom = () => pdf.page.height - pdf.page.margins.bottom - 18;

    const header = () => {
      pdf.rect(left, 24, width, 3).fill(NAVY);
      pdf.fillColor(NAVY).font('Helvetica-Bold').fontSize(14).text(doc.title, left, 34, { width });
      pdf.font('Helvetica').fontSize(8.5).fillColor('#334155');
      let y = pdf.y + 4;
      const colW = width / 3;
      doc.meta.forEach((m, i) => {
        const x = left + (i % 3) * colW;
        if (i % 3 === 0 && i > 0) y += 12;
        pdf.font('Helvetica-Bold').text(`${m.label}: `, x, y, { continued: true, width: colW - 6, lineBreak: false }).font('Helvetica').text(m.value, { lineBreak: false });
      });
      pdf.y = y + 18;
    };

    header();
    for (const [si, s] of doc.sections.entries()) {
      if (si > 0) {
        if (pdf.y > bottom() - 80) {
          pdf.addPage();
          header();
        } else pdf.y += 10;
      }
      if (doc.sections.length > 1) {
        pdf.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text(s.name, left, pdf.y);
        pdf.y += 4;
      }
      const fontSize = s.compact ? 6.5 : 7.5;
      const rowH = s.compact ? 12 : 15;
      const weights = s.columns.map((c) => c.width ?? 10);
      const total = weights.reduce((a, b) => a + b, 0);
      const widths = weights.map((w) => (w / total) * width);
      const drawHeader = () => {
        const y = pdf.y;
        const h = rowH + 6;
        pdf.rect(left, y, width, h).fill(NAVY);
        let x = left;
        pdf.font('Helvetica-Bold').fontSize(fontSize).fillColor('#FFFFFF');
        s.columns.forEach((c, i) => {
          pdf.text(c.label, x + 2, y + 4, { width: widths[i] - 4, height: h - 4, align: c.align ?? 'left', ellipsis: true });
          x += widths[i];
        });
        pdf.y = y + h;
      };
      drawHeader();
      const drawRow = (row: Record<string, unknown>, idx: number, bold = false) => {
        if (pdf.y + rowH > bottom()) {
          pdf.addPage();
          header();
          drawHeader();
        }
        const y = pdf.y;
        if (bold) pdf.rect(left, y, width, rowH).fill('#E8EDF3');
        else if (idx % 2 === 1) pdf.rect(left, y, width, rowH).fill('#F5F7FA');
        let x = left;
        pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
        s.columns.forEach((c, i) => {
          const v = str(row[c.key]);
          const color = s.cellColors?.[v];
          if (color && !bold) pdf.rect(x + 0.5, y + 0.5, widths[i] - 1, rowH - 1).fill(color);
          pdf.fillColor('#0F172A').text(v, x + 2, y + (rowH - fontSize) / 2 - 0.5, { width: widths[i] - 4, height: rowH, align: c.align ?? 'left', ellipsis: true, lineBreak: false });
          x += widths[i];
        });
        pdf.moveTo(left, y + rowH).lineTo(left + width, y + rowH).lineWidth(0.4).strokeColor(BORDER).stroke();
        pdf.y = y + rowH;
      };
      s.rows.forEach((row, i) => drawRow(row, i));
      if (!s.rows.length) {
        pdf.font('Helvetica-Oblique').fontSize(8).fillColor('#64748B').text('No records for the selected filters.', left, pdf.y + 6);
        pdf.y += 18;
      }
      if (s.totals) drawRow(s.totals, 0, true);
    }
    if (doc.signatures?.length) {
      if (pdf.y > bottom() - 60) {
        pdf.addPage();
        header();
      }
      const y = pdf.y + 36;
      const w = width / doc.signatures.length;
      doc.signatures.forEach((sig, i) => {
        const x = left + i * w;
        pdf.moveTo(x + 10, y).lineTo(x + w - 20, y).lineWidth(0.6).strokeColor('#334155').stroke();
        pdf.font('Helvetica').fontSize(8).fillColor('#334155').text(sig, x + 10, y + 4, { width: w - 30 });
      });
    }
    const range = pdf.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      pdf.switchToPage(i);
      // Writing inside the bottom margin would otherwise trigger an automatic page break.
      pdf.page.margins.bottom = 0;
      pdf.font('Helvetica').fontSize(7).fillColor('#64748B');
      pdf.text(`WINDGUARD · ${doc.title}`, left, pdf.page.height - 22, { width: width / 2, lineBreak: false });
      pdf.text(`Page ${i + 1} of ${range.count}`, left + width / 2, pdf.page.height - 22, { width: width / 2, align: 'right', lineBreak: false });
    }
    pdf.end();
  }
}
