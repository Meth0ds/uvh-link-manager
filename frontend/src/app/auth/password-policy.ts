// Bundle the generated backend policy so production and component tests execute
// the same implementation; do not maintain another list of scoring constants.
import "../../../public/uvh-password-policy.v1.js";

export interface PasswordAssessment {
  score: number;
  common: boolean;
  personal: boolean;
  patterned: boolean;
  feedback: string;
  acceptable: boolean;
}

interface GeneratedPasswordPolicy {
  policy: {
    minLength: number;
    maxLength: number;
    maxBytes: number;
    rejectWords: readonly string[];
    bands: { strong: number; good: number; fair: number };
    feedback: { common: string };
  };
  assess(password: string, name: string, email: string): Omit<PasswordAssessment, "acceptable">;
  isAcceptable(password: string, name: string, email: string): boolean;
  strengthLabel(score: number): string;
}

const generated = (globalThis as typeof globalThis & { uvhPasswordPolicy: GeneratedPasswordPolicy }).uvhPasswordPolicy;
export const passwordBands = generated.policy.bands;
export const passwordMeterSteps = [1, passwordBands.fair, passwordBands.good, passwordBands.strong];

/** Presentation cannot praise a password the generated acceptance gate rejects. */
export function assessPassword(password: string, name = "", email = ""): PasswordAssessment {
  const assessment = generated.assess(password, name, email);
  const acceptable = generated.isAcceptable(password, name, email);
  const folded = password.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const forbiddenWord = generated.policy.rejectWords.some(word => folded.includes(word));
  const tooLong = [...password].length > generated.policy.maxLength;
  const tooManyBytes = new TextEncoder().encode(password).length > generated.policy.maxBytes;
  return {
    ...assessment,
    acceptable,
    common: assessment.common || forbiddenWord,
    score: acceptable ? assessment.score : Math.min(assessment.score, passwordBands.fair - 1),
    feedback: tooLong ? `Utiliza como máximo ${generated.policy.maxLength} caracteres.`
      : tooManyBytes ? "La contraseña es demasiado larga. Acórtala, especialmente si usas emojis o caracteres especiales."
      : forbiddenWord ? generated.policy.feedback.common : assessment.feedback,
  };
}

export function passwordStrengthLabel(score: number): string {
  return generated.strengthLabel(score);
}
