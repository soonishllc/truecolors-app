import { DEMO_PHONES } from "@/lib/wholesale/demo";

// Who you can chat as in the demo: a stranger, the demo stockist or the demo display partner, with things to try.
export const PERSONAS = {
  new: {
    label: "New business",
    who: "A gift shop that's never dealt with Truecolors",
    phone: "15550000",
    tries: [
      "Hi, we run a gift shop at Dubai Mall. Can we stock your shirts?",
      "What displays do you have for hotels?",
      "Hola, tenemos una tienda en Tulum. ¿Venden al por mayor?",
    ],
  },
  stockist: {
    label: "Sara · Demo Gift Shop",
    who: "Stockist: buys outright, pays upfront, prices in USD",
    phone: DEMO_PHONES.stockist,
    tries: [
      "What designs do you have?",
      "I'd like 20 HABIBI in M and 20 in L",
      "Yes please, place it. I'll pay by card",
      "Where's my last order?",
      "Could you design a shirt with Dubai Marina and the dhows?",
      "كم سعر الجملة لقميص الشاطئ؟",
    ],
  },
  partner: {
    label: "Lucía · Demo Beach Resort",
    who: "Display partner: a Tower in the Lobby Boutique, settles in MXN",
    phone: DEMO_PHONES.partner,
    tries: [
      "How many HABIBI do we have left on the display?",
      "This week we sold 3 Dune Bashing in S, 2 We're All Emirati in L and 1 NYC in XL",
      "Yes, that's right",
      "Can you send us more stock?",
      "What do we owe so far this period?",
      "The UV light on the tower stopped working",
    ],
  },
} as const;
export type Persona = keyof typeof PERSONAS;
