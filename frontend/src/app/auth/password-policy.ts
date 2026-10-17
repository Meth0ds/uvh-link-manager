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

type FeedbackKey = "empty" | "common" | "personal" | "patterned" | "short" | "variety" | "default";
const feedbackCopy: Record<FeedbackKey, string> = {
  empty: $localize`:@@password.feedback.empty:Empieza con una frase larga que no uses en ningún otro sitio.`,
  common: $localize`:@@password.feedback.common:Evita palabras y contraseñas habituales: son las primeras que prueba un atacante.`,
  personal: $localize`:@@password.feedback.personal:No incluyas tu nombre ni la parte visible de tu email.`,
  patterned: $localize`:@@password.feedback.patterned:Sustituye secuencias y repeticiones previsibles por palabras no relacionadas.`,
  short: $localize`:@@password.feedback.short:Añade más caracteres: el mínimo es 10 y recomendamos una frase más larga.`,
  variety: $localize`:@@password.feedback.variety:Hazla más larga o combina tipos de caracteres para reducir patrones previsibles.`,
  default: $localize`:@@password.feedback.default:Buena base. Una frase única y larga es más fácil de recordar y más difícil de adivinar.`,
};

interface GeneratedPasswordPolicy {
  policy: {
    minLength: number;
    maxLength: number;
    maxBytes: number;
    rejectWords: readonly string[];
    bands: { strong: number; good: number; fair: number };
    feedback: { common: string };
  };
  assess(password: string, name: string, email: string): Omit<PasswordAssessment, "acceptable"> & { feedbackKey: FeedbackKey };
  isAcceptable(password: string, name: string, email: string): boolean;
  strengthLabel(score: number): string;
}

const generated = (globalThis as typeof globalThis & { uvhPasswordPolicy: GeneratedPasswordPolicy }).uvhPasswordPolicy;
export const passwordBands = generated.policy.bands;
export const passwordMeterSteps = [1, passwordBands.fair, passwordBands.good, passwordBands.strong];

/** Presentation cannot praise a password the generated acceptance gate rejects. */
export function assessPassword(password: string, name = "", email = ""): PasswordAssessment {
  const { feedbackKey, ...assessment } = generated.assess(password, name, email);
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
    feedback: tooLong ? $localize`:@@ui.224705a71e2d36:Utiliza como máximo ${generated.policy.maxLength} caracteres.`
      : tooManyBytes ? $localize`:@@ui.ce17a1cfa5e78d:La contraseña es demasiado larga. Acórtala, especialmente si usas emojis o caracteres especiales.`
      : forbiddenWord ? feedbackCopy.common : feedbackCopy[feedbackKey],
  };
}

export function passwordStrengthLabel(score: number): string {
  return score >= passwordBands.strong ? $localize`:@@password.strength.strong:Fuerte`
    : score >= passwordBands.good ? $localize`:@@password.strength.good:Buena`
    : score >= passwordBands.fair ? $localize`:@@password.strength.fair:Mejorable`
    : $localize`:@@password.strength.weak:Débil`;
}
