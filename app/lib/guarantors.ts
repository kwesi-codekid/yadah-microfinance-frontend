/** A guarantor as the forms send one: anybody, by name and phone. */
export interface GuarantorInput {
  fullName: string;
  phone: string;
  idNumber?: string;
}

/**
 * The guarantors a form posted, as `GuarantorFields` lays them out: three
 * parallel lists, one entry per block. Empty blocks are skipped; a block with
 * only half of what it needs is an error naming it.
 */
export function readGuarantors(
  form: FormData,
): { guarantors: GuarantorInput[] } | { error: string } {
  const list = (key: string) => form.getAll(key).map((v) => String(v).trim());
  const names = list("guarantorName");
  const phones = list("guarantorPhone");
  const ids = list("guarantorIdNumber");

  const guarantors: GuarantorInput[] = [];
  for (const [i, fullName] of names.entries()) {
    const phone = phones[i] ?? "";
    const idNumber = ids[i] ?? "";
    if (fullName === "" && phone === "" && idNumber === "") continue;
    if (fullName.length < 2 || phone === "") {
      return { error: `Guarantor ${i + 1} needs both a name and a phone.` };
    }
    guarantors.push({ fullName, phone, ...(idNumber ? { idNumber } : {}) });
  }
  return { guarantors };
}
