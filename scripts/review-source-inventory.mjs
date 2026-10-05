import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('typescript');
const php = JSON.parse(readFileSync(resolve(root, process.argv[2] ?? '.uvh-runtime/review-php-inventory.json'), 'utf8'));
const coverage = readFileSync(resolve(root, 'docs/superpowers/plans/2026-10-01-system-review-coverage.md'), 'utf8');
const routeOwners = new Map();
for (const row of coverage.split('\n')) {
  const system = row.match(/^\|\s*(S\d{2})\s*\|/)?.[1];
  const action = row.match(/`(\w+Controller)@(\w+)`/);
  if (system && action) routeOwners.set(`${action[1]}@${action[2]}`, system);
}

function proposedSystem(path, name = '') {
  const file = basename(path);
  if (['auth-entry.service.ts', 'registration.service.ts', 'auth-session-contracts.ts'].includes(file)) return { system: 'S01', basis: 'entry/registration transport and wire types; facade state and callers require review' };
  if (['account-profile.service.ts', 'account-mfa.service.ts', 'account-sessions.service.ts', 'auth-user-mutations.ts'].includes(file)) return { system: 'S01', basis: 'account transport/reconciliation; callers require review' };
  if (file === 'account-deletion.service.ts') return { system: 'S02', basis: 'account deletion transport; facade and callers require review' };
  if (file === 'account-data-export.service.ts') return { system: 'S02', basis: 'account export transport; facade and callers require review' };
  if (file === 'session-context.service.ts') return { system: 'S01', basis: 'shared local auth projection/clock; callers require review' };
  if (file === 'api-request-scope.ts') return { system: 'S13', basis: 'shared HTTP scope; reconcile S01/S03 callers' };
  const routed = routeOwners.get(`${file.replace(/\.php$/, '')}@${name}`);
  if (routed) return { system: routed, basis: 'route matrix' };
  if (file === 'credential-response-decoders.ts') {
    return { system: /token/i.test(name) ? 'S07' : /webhook|delivery/i.test(name) ? 'S08' : 'S13', basis: 'credential decoder purpose; shared helpers require caller review' };
  }
  if (file === 'public-action-response-decoders.ts' && /AccountDeletion/.test(name)) return { system: 'S02', basis: 'account deletion contract' };
  // Explicit ownership proposals. Shared dependencies still require per-caller review.
  if (/auth\.service\.ts|auth-response-decoders\.ts|settings\.component\.(ts|html|scss)/.test(file)) {
    if (/export|delet|privacy/i.test(name)) return { system: 'S02', basis: 'shared account function' };
    if (/auth\.service|auth-response|mfa|password|profile|email|session|reauth/i.test(file + name)) return { system: 'S01', basis: 'identity function' };
    return { system: 'S02', basis: 'shared account surface; reconcile callers' };
  }
  if (/\/Support\/Auth\/|SecurityContext\.php$/.test(path)) {
    return { system: 'S01', basis: 'identity admission; shared workspace callers require S03 review' };
  }
  const rules = [
    ['S02', /AccountController|PrivacyRights|AccountDeletion|DataExport|AccountExport|PrivateArtifact|ExportTooLarge|privacy|account-deletion|data-export|browser-download/],
    ['S03', /invitation-accept/],
    ['S12', /auth-shell/],
    ['S01', /MfaChallengeController|MfaSessionController|MfaConfigurationController|AuthController|AccountProfileController|AccountCredentialsController|AccountSessionsController|NormalizesRecoveryCodes|RegistrationController|PasswordRecoveryController|SecurityIncidentController|ValidatesAuthInput|EqualizesPublicMailDuration|AccountRecovery|EmailChangeRequest|EmailToken|PendingRegistration|RegistrationAttempt|RegistrationEdit|SessionManager|UvhSession|UvhAuth|RequireMfa|Mfa|Totp|PasswordStrength|HCaptcha|HostOnlyCookie|EmitPasswordPolicy|DevTotp|PromoteAdmin|\/Models\/User\.php|LegalAcceptance|\/auth\/|auth-route|auth\.guard|hcaptcha-frame|uvh-password-policy|public-action-response|password-change-dialog|email-access-dialog|account-recovery-state|\/security\/|security-center-response/],
    ['S09', /WorkspaceActivity/],
    ['S03', /Workspace|Membership|Invitation|RequireWorkspace|\/team\/|workspace|invitation|PendingController|PendingHandoff|pending-handoff|pending-invitation|handoff-response/],
    ['S04', /LinkController|LinkBulkController|LinkException|TagController|CollectionController|LinkTemplate|LinkService|LinkIntent|\/Models\/(Link|Tag|Collection)\.php|\/links\/|\/collections\/|\/templates\/|\/tags\/|link-intent|link-response|link-state|pending-link-intent/],
    ['S05', /RedirectController|RedirectService|RedirectRule|VisitorAnswer|VisitorPage|\/redirect\/|\/handoff\//],
    ['S06', /Domain|DnsViews|Tls|EdgeController|PublicSuffixes|\/domains\/|domain-response|domain-state/],
    ['S07', /ApiToken|TokenController|RequireApiToken|\/tokens\/|api-token/],
    ['S08', /Webhook|Ssrf|ExternalEndpoint|PrivateIpv4Network|\/webhooks\/|webhook-label/],
    ['S09', /Analytics|MetricRollup|RecordClick|Quota|WorkspaceActivity|\/analytics\/|\/activity\/|\/dashboard\/|usage|scale-response/],
    ['S10', /Mail|Audit|Notification|OperationalNotices|DomainNotices|\/notifications\/|notification|mail-outbox/],
    ['S11', /AdminController|AdminText|Destination|Reputation|LinkBlockReason|\/admin\/|admin-|destination-entry|report-status|appeal-status/],
    ['S12', /PublicController|FrontendUrl|\/legal\/|\/help\/|\/landing\/|auth-shell|theme|public-response|public-status|panel\.component|page-header|skeleton|queue-section|queue-primitives|status-page|action-dialog|async-operation-status|dialog-identity|scale-dialog|_identity-tokens|_public-identity|getting-started|\/styles\.scss|\/index\.html|backend-laravel\/resources\//],
    ['S13', /OperationsController|ProductionSecurity|ReleaseReadiness|OperationalMetrics|QueueBacklog|Crypto|SealedToken|SignedToken|SealFormat|RotateAppSecret|CheckSealFormats|UvhReleaseCheck|UvhHealthcheck|UvhHousekeeping|UvhE2eResetLimits|UvhLimiters|UvhRateLimiter|Idempotency|Streams|HttpLatency|RequestTrace|Ids\.php|IsoDate|UrlUtil|SearchTerm|Csv|Ua\.php|UvhRequest|api\.service|api\.interceptor|api-message|count-label|date-time-label|paginator-intl|queue-paging|resource-type-label|unicode-validators|models\.ts|app\.component|app\.config|main\.ts|panel\.routes|proxy\.conf|\/Controllers\/Controller\.php|latest-request|owned-mutations|async-poller|idempotent-intent|strict-wire|response-decoder-helpers|retry|\/bootstrap\/|\/config\/|\/routes\/|\/Providers\/|\/Http\/Middleware\/|^scripts\//],
  ];
  for (const [system, pattern] of rules) if (pattern.test(path)) return { system, basis: 'file proposal; reconcile callers' };
  return { system: 'S13', basis: 'provisional fallback; owner requires review' };
}

const paths = execFileSync('rg', ['--files', 'frontend/src', 'frontend/public', 'backend-laravel/resources', 'scripts'], { cwd: root, encoding: 'utf8' })
  .trim().split('\n').filter(path => !/\.spec\.|\.test\.|\/test\//.test(path) && /\.(ts|js|mjs|php|html|scss|css|py)$/.test(path));
const files = [...php];
for (const path of paths.sort()) {
  const source = readFileSync(resolve(root, path), 'utf8');
  const functions = [];
  const language = /\.(ts|js|mjs)$/.test(path) ? 'typescript/javascript' : 'surface/file';
  if (language === 'typescript/javascript') {
    const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
    if (parsed.parseDiagnostics.length) throw new Error(`Parse error in ${path}`);
    function visit(node, ownerFunction = null) {
      const callable = (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && node.body;
      let owner = ownerFunction;
      if (callable) {
        const named = node.name ?? ((ts.isVariableDeclaration(node.parent) || ts.isPropertyDeclaration(node.parent) || ts.isPropertyAssignment(node.parent)) ? node.parent.name : undefined);
        const name = ts.isConstructorDeclaration(node) ? 'constructor' : named?.getText(parsed).replace(/\s+/g, ' ').slice(0, 120) ?? null;
        functions.push({ name, ownerFunction: name ? null : ownerFunction, kind: ts.isArrowFunction(node) ? 'arrow' : ts.isFunctionExpression(node) ? 'closure' : 'named', line: parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1, endLine: parsed.getLineAndCharacterOfPosition(node.getEnd()).line + 1 });
        owner = name ?? ownerFunction;
      }
      ts.forEachChild(node, child => visit(child, owner));
    }
    visit(parsed);
  }
  files.push({ path, language, sha256: createHash('sha256').update(source).digest('hex'), functions });
}
files.sort((left, right) => left.path.localeCompare(right.path));
for (const file of files) {
  file.proposedOwner = proposedSystem(file.path);
  for (const fn of file.functions) {
    fn.proposedOwner = proposedSystem(file.path, fn.name ?? fn.ownerFunction ?? '');
    fn.review = 'Inventory only; reconcile with coverage matrix and direct evidence';
  }
}
const totals = { files: files.length, named: 0, anonymous: 0, signatures: 0, provisionalFiles: files.filter(file => file.proposedOwner.basis.startsWith('provisional')).length };
const systems = new Map();
for (const file of files) for (const fn of file.functions) {
  if (fn.kind === 'signature') totals.signatures++;
  else if (fn.name === null) totals.anonymous++;
  else totals.named++;
  systems.set(fn.proposedOwner.system, (systems.get(fn.proposedOwner.system) ?? 0) + 1);
}
const prefix = resolve(root, 'docs/superpowers/plans/2026-10-02-source-function-inventory');
const capturedAt = new Date().toISOString();
writeFileSync(prefix + '.json', JSON.stringify({ capturedAt, date: '2026-10-02', scope: 'PHP app/bootstrap/config/routes; frontend src/public; backend resources; scripts. Excludes vendor, dependencies, build/cache, tests, migration history and non-code infrastructure. Surface files include Blade/HTML/SCSS without parsing template expressions or embedded scripts.', caveats: 'Enumeration is not review. PHP named functions, signatures, closures and arrow tokens; TypeScript AST executable functions, methods, accessors and arrows. Anonymous expressions inherit their enclosing named function where known. Proposed ownership is provisional and must be reconciled per caller; route coverage retains existing evidence. No runtime execution or Laravel bootstrap.', totals, files }, null, 2) + '\n');
const rows = files.map(file => `| \`${file.path}\` | ${[...new Set([file.proposedOwner.system, ...file.functions.map(fn => fn.proposedOwner.system)])].sort().join(', ')} | ${file.functions.filter(fn => fn.name !== null && fn.kind !== 'signature').length} | ${file.functions.filter(fn => fn.name === null).length} | ${file.proposedOwner.basis.startsWith('provisional') ? 'Propietario provisional' : 'Conciliar evidencia por función'} |`).join('\n');
writeFileSync(prefix + '.md', `# Inventario de funciones y superficies — 2026-10-02\n\nCaptura del árbol: ${capturedAt}. La fecha del nombre identifica la creación del inventario; esta captura registra su actualización.\n\n${totals.files} archivos; ${totals.named} funciones/métodos con nombre; ${totals.anonymous} callbacks/closures anónimos; ${totals.signatures} firmas sin cuerpo. ${totals.provisionalFiles} archivos sin propuesta específica de propietario. Todas las propuestas requieren conciliación por consumidor; enumerar no acredita revisar. La [matriz de rutas](2026-10-01-system-review-coverage.md) conserva la evidencia previa; el [JSON](2026-10-02-source-function-inventory.json) contiene líneas, hashes, funciones y propietario propuesto.\n\nCobertura: PHP app/bootstrap/config/routes y AST TypeScript/JavaScript de frontend src/public/scripts. HTML/Blade/SCSS y scripts Python/PHP auxiliares se inventarían como superficies; no se analizan expresiones de plantilla ni JS embebido. Migraciones, infraestructura YAML/Docker/CI y dependencias necesitan inventario específico S13. No se ejecuta código de la aplicación ni se conecta a la DB. Callbacks heredan función contenedora cuando es identificable; propietarios compartidos deben conciliarse por consumidor antes de cerrar un sistema.\n\nRegeneración desde la raíz:\n\n\`\`\`sh\ndocker compose -f docker-compose.local.yml --env-file .env.docker.local run --rm --no-deps app php /repo/scripts/review-php-source-inventory.php > .uvh-runtime/review-php-inventory.json\nnode scripts/review-source-inventory.mjs\n\`\`\`\n\n| Sistema propuesto | Entradas de funciones/callbacks |\n| --- | --- |\n${[...systems].sort().map(([system, count]) => `| ${system} | ${count} |`).join('\n')}\n\n| Archivo | Sistema propuesto | Con nombre | Anónimas | Estado de conciliación |\n| --- | --- | --- | --- | --- |\n${rows}\n`);
console.log(JSON.stringify({ totals, systems: Object.fromEntries([...systems].sort()) }));
