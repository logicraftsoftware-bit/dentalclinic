export type ReportSheet = { name: string; headers: string[]; rows: (string | number)[][] };
const rupees = (amount: number) => Number(((amount || 0) / 100).toFixed(2));
export const summaryColumns = [['collected', 'Collected'], ['commission', 'Doctor commission'], ['clinic', 'Clinic share']] as const;

export function accountReportSheets(data: any): ReportSheet[] {
  const amounts = (row: any) => summaryColumns.map(([key]) => rupees(row[key]));
  const headers = summaryColumns.map(([, label]) => `${label} (INR)`);
  const receipts = data.rows.flatMap((row: any) => row.receipts.map((receipt: any) => ({ ...receipt, patient: row.patient, doctor: row.doctor, procedure: row.procedure })));
  const daily = new Map<string, Record<string, number>>();
  for (const receipt of receipts) {
    if (receipt.method === 'CREDIT') continue;
    const day = daily.get(receipt.date) || {};
    day[receipt.method] = (day[receipt.method] || 0) + receipt.amount;
    daily.set(receipt.date, day);
  }
  const methods = data.paymentMethods.map((r: any) => r.method);
  return [
    { name: 'Summary', headers: ['Measure', 'Amount (INR)'], rows: Object.entries(data.totals).map(([key, value]) => [key.replace(/([A-Z])/g, ' $1').replace(/^./, letter => letter.toUpperCase()), rupees(value as number)]) },
    ...['doctors', 'procedures'].map(key => ({ name: key === 'doctors' ? 'Doctor wise' : 'Procedure wise', headers: [key === 'doctors' ? 'Doctor' : 'Procedure', ...headers], rows: [...data[key].map((r: any) => [r.label, ...amounts(r)]), ['Total', ...amounts(data.totals)]] })),
    { name: 'Invoice details', headers: ['Invoice date', 'Patient', 'Doctor', 'Procedure', 'Status', ...headers, 'Patient balance (INR)'], rows: [...data.rows.map((r: any) => [r.date, r.patient, r.doctor, r.procedure, r.status || '', ...amounts(r), rupees(r.outstanding)]), ['Total', '', '', '', '', ...amounts(data.totals), rupees(data.totals.outstanding)]] },
    { name: 'Payment methods', headers: ['Method', 'Collected (INR)'], rows: [...data.paymentMethods.map((r: any) => [r.method, rupees(r.amount)]), ['Total', rupees(data.totals.collected)]] },
    { name: 'Daily collections', headers: ['Date', ...methods.map((m: string) => `${m} (INR)`), 'Total (INR)'], rows: [...[...daily].sort(([a], [b]) => a.localeCompare(b)).map(([day, values]) => [day, ...methods.map((m: string) => rupees(values[m])), rupees(Object.values(values).reduce((a, b) => a + b, 0))]), ['Total', ...data.paymentMethods.map((r: any) => rupees(r.amount)), rupees(data.totals.collected)]] },
    { name: 'Payment details', headers: ['Date', 'Patient', 'Doctor', 'Procedure', 'Method', 'Reference', 'Amount (INR)'], rows: [...receipts.map((r: any) => [r.date, r.patient, r.doctor, r.procedure, r.method, r.reference || '', rupees(r.amount)]), ['Total including credit used', '', '', '', '', '', rupees(receipts.reduce((n: number, r: any) => n + r.amount, 0))]] },
    { name: 'Credit and refund audit', headers: ['Date', 'Patient', 'Procedure', 'Action', 'Reason', 'User', 'Method', 'Credit movement (INR)', 'Commission reversed (INR)'], rows: [...(data.activity || []).map((r: any) => [r.date, r.patient, r.procedure, r.type, r.reason || '', r.actorName || '', r.method || '', rupees(r.amountPaise), rupees(r.commissionReversalPaise)]), ['Total', '', '', '', '', '', '', rupees((data.activity || []).reduce((n: number, r: any) => n + (r.amountPaise || 0), 0)), rupees(data.totals.commissionReversed)]] },
  ];
}

export async function exportAccounts(data: any, format: 'excel' | 'pdf') {
  const sheets = accountReportSheets(data);
  const period = `${data.filters.from || 'Beginning'} to ${data.filters.to || 'present'}`;
  const doctor = data.doctorOptions.find((d: any) => d.id === data.filters.doctorId)?.name || 'All doctors & clinic';
  const context = `${period} | ${doctor} | ${data.filters.procedure || 'All procedures'}`;
  const filename = `accounts-${data.filters.from || 'all'}-${data.filters.to || 'time'}`;
  if (format === 'excel') {
    const { Workbook } = await import('exceljs');
    const workbook = new Workbook();
    for (const report of sheets) {
      const sheet = workbook.addWorksheet(report.name);
      sheet.addRow([report.name]); sheet.addRow([context]); sheet.addRow(report.headers);
      for (const row of report.rows) sheet.addRow(row);
      sheet.getRow(3).font = { bold: true };
      sheet.views = [{ state: 'frozen', ySplit: 3 }];
      sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: report.headers.length } };
      sheet.columns.forEach((column, index) => {
        column.width = index === 0 ? 30 : 23;
        if (report.headers[index].includes('(INR)')) column.numFmt = '#,##0.00;[Red]-#,##0.00';
      });
    }
    const bytes = await workbook.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const link = document.createElement('a'); link.href = url; link.download = `${filename}.xlsx`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } else {
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
    const doc = new jsPDF({ orientation: 'landscape', format: 'a4' });
    sheets.forEach((sheet, index) => {
      if (index) doc.addPage();
      doc.setFontSize(16); doc.text(`Accounts - ${sheet.name}`, 12, 15);
      doc.setFontSize(9); doc.text(doc.splitTextToSize(context, 270), 12, 22);
      autoTable(doc, { startY: 36, head: [sheet.headers], body: sheet.rows, styles: { fontSize: 8, overflow: 'linebreak' }, headStyles: { fillColor: [0, 115, 99] }, margin: { left: 12, right: 12 }, showHead: 'everyPage' });
    });
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) { doc.setPage(p); doc.setFontSize(8); doc.text(`Amounts in INR | Page ${p} of ${pages}`, 12, 204); }
    doc.save(`${filename}.pdf`);
  }
}
