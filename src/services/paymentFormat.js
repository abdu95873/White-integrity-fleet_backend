import { paymentBreakdown } from "./calculations.js";



export function formatPaymentRecord(record) {

  const periodCalculated = Number(record.periodCalculated);

  const commissionUsed = Number(record.commissionUsed);

  const taxUsed = Number(record.taxUsed);



  let commissionAmount =

    record.commissionAmount != null ? Number(record.commissionAmount) : null;

  let taxAmount = record.taxAmount != null ? Number(record.taxAmount) : null;



  if (commissionAmount == null || taxAmount == null) {

    const breakdown = paymentBreakdown(periodCalculated, commissionUsed, taxUsed);

    commissionAmount = breakdown.commissionAmount;

    taxAmount = breakdown.taxAmount;

  }



  return {

    ...record,

    periodCalculated,

    commissionUsed,

    taxUsed,

    taxAmount,

    commissionAmount,
    userReceivableAmount: Number(record.userReceivableAmount ?? 0),
    calculatedGrandPayment: Number(record.calculatedGrandPayment),

    previousDueAmount: Number(record.previousDueAmount),

    adjustmentAmount: Number(record.adjustmentAmount ?? 0),

    totalPayable: Number(record.totalPayable),

  };

}

