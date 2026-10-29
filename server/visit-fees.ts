// Stable keys let appointment, reception and clinical billing share visit fees.
export async function ensureVisitFees(store: any, appointment: any) {
  const existing = await store.list('invoice', { appointmentId: appointment.id });
  const fees = [
    ['Consultant fee', appointment.consultationPaise],
    ['Visiting consultant fee', appointment.visitingConsultationPaise],
    ['Clinic fee', appointment.clinicFeePaise],
  ];
  for (const [index, [description, amount]] of fees.entries()) {
    if (Number(amount) > 0 && !existing.some((i: any) => i.description === description)) {
      await store.create('invoice', {
        patientId: appointment.patientId, appointmentId: appointment.id,
        sourceKey: `${appointment.id}:fee:${index}`, description: String(description),
        chargeKind: 'VISIT', totalPaise: Number(amount),
      });
    }
  }
}
