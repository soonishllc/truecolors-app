"use client";

import { useEffect, useState } from "react";

type Tier = { fromUnits: number; discountBps: number };

// The stockist order form's running total, kept at the bottom of the screen: shirts so far, the estimated total at
// the tier they reach, and how many more to the minimum or the next tier. The quote that follows is the real price.
export function OrderTally({ formId, tiers, min, currency }: { formId: string; tiers: Tier[]; min: number; currency: string }) {
  const [units, setUnits] = useState(0);
  const [retail, setRetail] = useState(0);

  useEffect(() => {
    const form = document.getElementById(formId);
    if (!form) return;
    const count = () => {
      let u = 0, r = 0;
      form.querySelectorAll<HTMLInputElement>("input[data-price]").forEach((i) => {
        const q = Math.max(0, Number(i.value) || 0);
        u += q;
        r += q * Number(i.dataset.price);
      });
      setUnits(u);
      setRetail(r);
    };
    form.addEventListener("input", count);
    count();
    return () => form.removeEventListener("input", count);
  }, [formId]);

  const tier = tiers.filter((t) => units >= t.fromUnits).at(-1);
  const next = tiers.find((t) => units < t.fromUnits);
  const fmt = (n: number) => new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  return (
    <div className="order-tally" role="status">
      <strong>{units < min ? `${units} of ${min} shirts` : `${units} shirts`}{tier ? ` · about ${fmt((retail * (10_000 - tier.discountBps)) / 10_000)}` : ""}</strong>
      <span className="small">
        {units < min ? `${min - units} more to reach the ${min}-shirt minimum`
          : next ? `${tier!.discountBps / 100}% off · ${next.fromUnits - units} more for ${next.discountBps / 100}%`
          : `${tier!.discountBps / 100}% off, our best price`}
      </span>
    </div>
  );
}
