import type { ImageSourcePropType } from "react-native";
import gpay from "../../assets/brand/gpay.png";
import paytm from "../../assets/brand/paytm.png";
import phonepe from "../../assets/brand/phonepe.jpg";
import upi from "../../assets/brand/upi.png";
import usdt from "../../assets/brand/usdt.png";
import { brandKey, type BrandKey } from "@/payments/method-key";

/** The payment brand logos (from the website's /brand folder). They are drawn on a white tile: see `IconTile`. */
export const BRAND_LOGOS: Record<BrandKey, ImageSourcePropType> = { PhonePe: phonepe, Gpay: gpay, PayTM: paytm, UPI: upi, USDT: usdt };

/** The logo for a method label ("PhonePe", "USDT (TRC-20)", the "any" UPI app), or `undefined` when it has none. */
export function logoFor(label: string): ImageSourcePropType | undefined {
  const key = brandKey(label);
  return key ? BRAND_LOGOS[key] : undefined;
}
