export const cancellationQuestions = {
  'en-IN': 'Hi, I’m CleanSheet. Do you want to cancel this subscription and stop future automatic payments? Please say yes or no.',
  'hi-IN': 'नमस्ते, मैं क्लीनशीट हूँ। क्या आप यह सदस्यता रद्द करके आगे के स्वचालित भुगतान रोकना चाहते हैं? कृपया हाँ या नहीं कहें।',
  'kn-IN': 'ನಮಸ್ಕಾರ, ನಾನು ಕ್ಲೀನ್‌ಶೀಟ್. ಈ ಚಂದಾದಾರಿಕೆಯನ್ನು ರದ್ದುಮಾಡಿ ಮುಂದಿನ ಸ್ವಯಂಚಾಲಿತ ಪಾವತಿಗಳನ್ನು ನಿಲ್ಲಿಸಲು ಬಯಸುವಿರಾ? ದಯವಿಟ್ಟು ಹೌದು ಅಥವಾ ಇಲ್ಲ ಎಂದು ಹೇಳಿ.',
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
