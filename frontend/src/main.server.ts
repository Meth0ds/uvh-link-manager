import { mergeApplicationConfig } from "@angular/core";
import { bootstrapApplication, type BootstrapContext } from "@angular/platform-browser";
import { provideServerRendering, withRoutes } from "@angular/ssr";
import { AppComponent } from "./app/app.component";
import { appConfig } from "./app/app.config";
import { serverRoutes } from "./app/app.routes.server";
const config = mergeApplicationConfig(appConfig, {providers:[provideServerRendering(withRoutes(serverRoutes))]});
export default (context: BootstrapContext) => bootstrapApplication(AppComponent, config, context);
