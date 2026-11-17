const rupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
export const inr = (value: number) => `₹${rupees.format(value)}`;
