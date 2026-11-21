export const cancellationQuestions = {
  'en-IN': 'Hi, I’m CleanSheet. Do you want to cancel this subscription and stop future automatic payments? Please say yes or no.',
  'hi-IN': 'नमस्ते। यह क्लीन शीट है। क्या आप इस सदस्यता का ऑटो पे बंद करना चाहते हैं? बंद करने के लिए हाँ कहें। जारी रखने के लिए नहीं कहें।',
  'kn-IN': 'ನಮಸ್ಕಾರ. ಇದು ಕ್ಲೀನ್ ಶೀಟ್. ಈ ಚಂದಾದಾರಿಕೆಯ ಆಟೋ ಪೇ ನಿಲ್ಲಿಸಬೇಕಾ? ನಿಲ್ಲಿಸಲು ಹೌದು ಎಂದು ಹೇಳಿ. ಮುಂದುವರಿಸಲು ಇಲ್ಲ ಎಂದು ಹೇಳಿ.',
} as const;

export type BillingVoiceLocale = keyof typeof cancellationQuestions;

export function isBillingVoiceLocale(value: unknown): value is BillingVoiceLocale {
  return value === 'en-IN' || value === 'hi-IN' || value === 'kn-IN';
}

export function paymentCountText(locale: BillingVoiceLocale, count: number) {
  if (locale === 'hi-IN') {
    if (!count) return 'इस महीने किसी खिलाड़ी की फीस का भुगतान दर्ज नहीं है।';
    return count === 1 ? 'इस महीने एक खिलाड़ी ने फीस भरी है।' : `इस महीने ${count} खिलाड़ियों ने फीस भरी है।`;
  }
  if (locale === 'kn-IN') {
    return count ? `ಈ ತಿಂಗಳು ${count} ಆಟಗಾರರು ಶುಲ್ಕ ಪಾವತಿಸಿದ್ದಾರೆ.` : 'ಈ ತಿಂಗಳು ಯಾವುದೇ ಆಟಗಾರರ ಶುಲ್ಕ ಪಾವತಿ ದಾಖಲಾಗಿಲ್ಲ.';
  }
  return count ? `${count} ${count === 1 ? 'player has' : 'players have'} paid this month.` : 'No players have a verified fee payment for this month.';
}

export function feePreviewText(locale: BillingVoiceLocale, period: string, amountPaise: number) {
  const month = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${period}-01T00:00:00Z`));
  const amount = amountPaise / 100;
  if (locale === 'hi-IN') return `${month} की फीस ${amount} रुपये है। अभिभावक को भेजने के लिए, फीस भेज दो कहें।`;
  if (locale === 'kn-IN') return `${month} ಶುಲ್ಕ ${amount} ರೂಪಾಯಿ. ಪೋಷಕರಿಗೆ ಕಳುಹಿಸಲು, ಶುಲ್ಕ ಕಳುಹಿಸಿ ಎಂದು ಹೇಳಿ.`;
  return `The fee for ${month} is ${amount} rupees. To send it to the parent, say send fee.`;
}
