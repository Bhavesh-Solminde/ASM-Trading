package expo.modules.smsreader

/**
 * Mirrors apps/harness/lib/parseSms.ts, kept deliberately minimal — this is
 * only used for the human-readable checkpoint record (amount + reference
 * shown in the log), never to decide whether to forward. The server parses
 * authoritatively; the raw body is always sent regardless of what this
 * extracts.
 */
object SmsParser {
  private val AMOUNT_RE =
    Regex("""(?:(?:rs\.?|inr|₹)\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?))|\b([0-9]+\.[0-9]{2})\b""", RegexOption.IGNORE_CASE)
  private val REF_LABEL_RE =
    Regex("""(?:ref(?:erence)?\s*(?:no\.?|number)?|utr|txn\s*id)\s*[:\-]?\s*([a-z0-9]{6,22})""", RegexOption.IGNORE_CASE)
  private val BARE_REF_RE = Regex("""\b([0-9]{9,22})\b""")

  fun parseAmountInr(body: String): Int? {
    val match = AMOUNT_RE.find(body) ?: return null
    val raw = match.groupValues[1].ifEmpty { match.groupValues[2] }
    val value = raw.replace(",", "").toDoubleOrNull() ?: return null
    return Math.round(value * 100).toInt()
  }

  fun parseUtr(body: String): String? {
    REF_LABEL_RE.find(body)?.let { return it.groupValues[1] }
    BARE_REF_RE.find(body)?.let { return it.groupValues[1] }
    return null
  }
}
