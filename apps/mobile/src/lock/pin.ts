export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

export function hashPin(pin: string, salt: string, sha256: (s: string) => Promise<string>): Promise<string> {
  return sha256(`${salt}:${pin}`);
}
