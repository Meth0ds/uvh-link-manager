import { registerLocaleData } from "@angular/common";
import spanish from "@angular/common/locales/es";
import britishEnglish from "@angular/common/locales/en-GB";
import french from "@angular/common/locales/fr";
// Register explicitly for both browser and static rendering. No browser-language inference.
registerLocaleData(spanish, "es");
registerLocaleData(spanish, "es-ES");
registerLocaleData(britishEnglish, "en-GB");
registerLocaleData(french, "fr");
registerLocaleData(french, "fr-FR");
