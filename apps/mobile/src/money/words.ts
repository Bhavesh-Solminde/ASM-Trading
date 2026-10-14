export type WordsLocale = "en" | "hi";

const EN_ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** 0–99 in Hindi (the numbers are irregular, so they are listed). */
const HI = [
  "शून्य", "एक", "दो", "तीन", "चार", "पाँच", "छह", "सात", "आठ", "नौ",
  "दस", "ग्यारह", "बारह", "तेरह", "चौदह", "पंद्रह", "सोलह", "सत्रह", "अठारह", "उन्नीस",
  "बीस", "इक्कीस", "बाईस", "तेईस", "चौबीस", "पच्चीस", "छब्बीस", "सत्ताईस", "अट्ठाईस", "उनतीस",
  "तीस", "इकतीस", "बत्तीस", "तैंतीस", "चौंतीस", "पैंतीस", "छत्तीस", "सैंतीस", "अड़तीस", "उनतालीस",
  "चालीस", "इकतालीस", "बयालीस", "तैंतालीस", "चवालीस", "पैंतालीस", "छियालीस", "सैंतालीस", "अड़तालीस", "उनचास",
  "पचास", "इक्यावन", "बावन", "तिरपन", "चौवन", "पचपन", "छप्पन", "सत्तावन", "अट्ठावन", "उनसठ",
  "साठ", "इकसठ", "बासठ", "तिरसठ", "चौंसठ", "पैंसठ", "छियासठ", "सड़सठ", "अड़सठ", "उनहत्तर",
  "सत्तर", "इकहत्तर", "बहत्तर", "तिहत्तर", "चौहत्तर", "पचहत्तर", "छिहत्तर", "सतहत्तर", "अठहत्तर", "उन्यासी",
  "अस्सी", "इक्यासी", "बयासी", "तिरासी", "चौरासी", "पचासी", "छियासी", "सत्तासी", "अट्ठासी", "नवासी",
  "नब्बे", "इक्यानवे", "बानवे", "तिरानवे", "चौरानवे", "पचानवे", "छियानवे", "सत्तानवे", "अट्ठानवे", "निन्यानवे",
];

interface Lang {
  under100: (n: number) => string;
  hundred: string;
  thousand: string;
  lakh: string;
  crore: string;
}

const LANG: Record<WordsLocale, Lang> = {
  en: {
    under100: (n) => {
      if (n < 20) return EN_ONES[n] ?? "";
      const unit = n % 10;
      const tens = EN_TENS[Math.floor(n / 10)] ?? "";
      return unit ? `${tens}-${EN_ONES[unit] ?? ""}` : tens;
    },
    hundred: "hundred",
    thousand: "thousand",
    lakh: "lakh",
    crore: "crore",
  },
  hi: { under100: (n) => HI[n] ?? "", hundred: "सौ", thousand: "हज़ार", lakh: "लाख", crore: "करोड़" },
};

function under1000(n: number, l: Lang): string[] {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h) parts.push(`${l.under100(h)} ${l.hundred}`);
  if (r) parts.push(l.under100(r));
  return parts;
}

/** Words for n > 0 on the Indian scale; crores above 999 recurse ("one hundred twenty-three crore"). */
function spell(n: number, l: Lang): string[] {
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor(n / 100_000) % 100;
  const thousand = Math.floor(n / 1000) % 100;
  const rest = n % 1000;
  const parts: string[] = [];
  if (crore) parts.push(...spell(crore, l), l.crore);
  if (lakh) parts.push(l.under100(lakh), l.lakh);
  if (thousand) parts.push(l.under100(thousand), l.thousand);
  if (rest) parts.push(...under1000(rest, l));
  return parts;
}

/**
 * Whole rupees as a cheque writes them: "Two thousand five hundred rupees only" / "दो हज़ार पाँच सौ रुपये मात्र".
 * Empty for 0 (the keypad hides the line). Paise are not spelled (INR stakes are whole rupees).
 */
export function amountInWords(rupees: number, locale: WordsLocale): string {
  const n = Math.floor(Math.abs(rupees));
  if (n === 0) return "";
  const words = spell(n, LANG[locale]).join(" ");
  if (locale === "hi") return `${words} ${n === 1 ? "रुपया" : "रुपये"} मात्र`;
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} ${n === 1 ? "rupee" : "rupees"} only`;
}
