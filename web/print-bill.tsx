import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BillReceipt } from './bill-receipt';
import { api } from './api';

export async function printPatientBill(invoice: any, workspace: any, patient: any, payments: any[] = []) {
  const popup = window.open('', '_blank');
  if (!popup) throw new Error('Allow pop-ups to print the bill.');
  popup.document.title = 'Patient bill';
  popup.document.body.textContent = 'Preparing bill...';
  try {
    const data = invoice.appointmentId ? await api(`/clinic/reception/${invoice.appointmentId}`) : {
      patient: patient || { id: invoice.patientId, name: 'Patient' },
      appointment: { id: invoice.id, createdAt: invoice.createdAt, startsAt: invoice.createdAt },
      invoices: [invoice], payments, doctors: [],
    };
    const zone = workspace?.tenant?.settings?.timezone || 'Asia/Kolkata';
    const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')];
    const loaded = styles.map(source => new Promise<void>(resolve => {
      const clone = source.cloneNode(true) as HTMLLinkElement;
      if (source instanceof HTMLLinkElement) {
        clone.href = source.href;
        clone.onload = () => resolve();
        clone.onerror = () => resolve();
      } else resolve();
      popup.document.head.appendChild(clone);
    }));
    popup.document.body.innerHTML = renderToStaticMarkup(<div className="reception-full-page"><div className="reception-billing"><BillReceipt data={data} workspace={workspace} zone={zone} /></div></div>);
    await Promise.all(loaded);
    await popup.document.fonts.ready;
    await Promise.all([...popup.document.images].map(img => img.decode().catch(() => {})));
    if (!popup.closed) { popup.focus(); popup.print(); }
  } catch (error) { popup.close(); throw error; }
}
