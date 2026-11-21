export type RelayCallKind =
  | 'precharge_parent_call'
  | 'recovery_parent_call_and_link';

export interface RelayCallScript {
  kind: RelayCallKind;
  audience: 'parent' | 'coach';
  title: string;
  trigger: string;
  hindiScript: string;
  kannadaScript: string;
  englishSummary: string;
}

export const RELAY_CALL_SCRIPTS: ReadonlyArray<RelayCallScript> = [
  {
    kind: 'precharge_parent_call',
    audience: 'parent',
    title: 'Pre-charge Parent Decision Reminder',
    trigger: 'Scheduled cycle enters awaiting_decision with verified contact & outreachConsent=granted',
    hindiScript:
      'नमस्ते, फर्स्ट टच अकादमी से रज़ बोल रहा हूँ। अंडर-12 डेमो प्लेयर की नवंबर 2026 फीस ₹1,500 देय है। कृपया अपने CleanSheet ऐप में लॉगिन करके Keep या Cancel चुनें।',
    kannadaScript:
      'ನಮಸ್ಕಾರ, ಫಸ್ಟ್ ಟಚ್ ಅಕಾಡೆಮಿಯಿಂದ ರಜ್ ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ. U12 ಡೆಮೊ ಪ್ಲೇಯರ್ ನವೆಂಬರ್ 2026 ಶುಲ್ಕ ₹1,500 ಬಾಕಿ ಇದೆ. ದಯವಿಟ್ಟು CleanSheet ಆಪ್‌ನಲ್ಲಿ Keep ಅಥವಾ Cancel ಆಯ್ಕೆಮಾಡಿ.',
    englishSummary:
      'Directs the authenticated parent back to CleanSheet to confirm Keep or Cancel before debit.',
  },
  {
    kind: 'recovery_parent_call_and_link',
    audience: 'parent',
    title: 'Failed Payment Recovery Call & Checkout Link',
    trigger: 'Terminal debit failure with no retry pending and verified outreachConsent=granted',
    hindiScript:
      'नमस्ते, फर्स्ट टच अकादमी की नवंबर 2026 की ₹1,500 फीस का ऑटो-डेबिट पूरा नहीं हुआ। हमने आपके CleanSheet खाते पर एक सुरक्षित Cashfree रिकवरी लिंक भेजा है।',
    kannadaScript:
      'ನಮಸ್ಕಾರ, ಫಸ್ಟ್ ಟಚ್ ಅಕಾಡೆಮಿಯ ನವೆಂಬರ್ 2026ರ ₹1,500 ಆಟೋ-ಡೆಬಿಟ್ ವಿಫಲವಾಗಿದೆ. ನಿಮ್ಮ CleanSheet ಖಾತೆಯಲ್ಲಿ ಸುರಕ್ಷಿತ Cashfree ರಿಕವರಿ ಲಿಂಕ್ ಲಭ್ಯವಿದೆ.',
    englishSummary:
      'Notifies parent of terminal debit failure and points to single reserved Cashfree recovery link.',
  },
];
