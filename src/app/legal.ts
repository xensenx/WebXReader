export const WELCOME_PATH = '/welcome';
export const TERMS_PATH = '/terms-of-use';
export const PRIVACY_PATH = '/privacy-policy';

// Bump this document version only when the Terms require renewed acknowledgment.
export const TERMS_VERSION = '2026-11-28.1';

export interface TermsAcceptance {
  accepted: boolean;
  termsVersion: string;
  acceptedAt: number;
}

export function hasAcceptedCurrentTerms(record: TermsAcceptance | undefined): boolean {
  return record?.accepted === true && record.termsVersion === TERMS_VERSION &&
    Number.isSafeInteger(record.acceptedAt) && record.acceptedAt > 0;
}
