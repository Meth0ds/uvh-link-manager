import { registerLocaleData } from "@angular/common";
import spanish from "@angular/common/locales/es";
import britishEnglish from "@angular/common/locales/en-GB";
// Register explicitly for both browser and static rendering. No browser-language inference.
registerLocaleData(spanish, "es");
registerLocaleData(spanish, "es-ES");
registerLocaleData(britishEnglish, "en-GB");
