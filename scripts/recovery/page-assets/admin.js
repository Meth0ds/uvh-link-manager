const $ = id => document.getElementById(id);
let token = null, state = null, busy = false, emergency = false;
const date = value => value ? new Date(value).toLocaleString('es-ES') : '—';
function error(message) {
    $('error').textContent = message;
    $('error').hidden = !message;
}
async function api(path, body) {
    const response = await fetch('/__uvh/api/' + path, { method: body ? 'POST' : 'GET', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-UVH-Recovery': token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
    const result = await response.json();
    if (!response.ok) {
        if (response.status === 401) {
            token = null;
            $('content').hidden = true;
            $('login').hidden = false;
        }
        throw Error(result.error || 'No se pudo completar la solicitud.');
    }
    return result;
}
function node(tag, text, cls) {
    const el = document.createElement(tag);
    if (text !== undefined)
        el.textContent = text;
    if (cls)
        el.className = cls;
    return el;
}
function button(label, action, target) {
    const el = node('button', label);
    el.type = 'button';
    el.dataset.operationAction = action;
    el.disabled = busy;
    el.addEventListener('click', () => command(action, target));
    return el;
}
async function chooseSelective(target) {
    $('selective-paths').value = '';
    $('selective-dialog').showModal();
    const confirmed = await new Promise(resolve => $('selective-dialog').addEventListener('close', () => resolve($('selective-dialog').returnValue === 'confirm'), { once: true }));
    if (!confirmed)
        return null;
    const paths = $('selective-paths').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    return paths.length ? { ...target, paths } : null;
}
async function ask(title, message) {
    $('confirm-title').textContent = title;
    $('confirm-message').textContent = message;
    const dialog = $('confirm-dialog');
    dialog.showModal();
    return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
}
async function command(action, target = {}) {
    if (busy)
        return;
    if (action === 'restore-selective') {
        target = await chooseSelective(target);
        if (!target)
            return;
    }
    if (['install', 'preflight'].includes(action)) {
        if (!state?.github?.sha) {
            error('Consulta las versiones primero.');
            return;
        }
        target = { sha: state.github.sha };
    }
    const chosen = state?.backups.find(item => item.id === target.id);
    const messages = { install: 'Se pondrá la app en mantenimiento, se creará una copia verificada y se instalará el commit seleccionado. Si falla antes de abrir, se restaurará la copia.', restore: 'Se recuperarán el código, la base de datos y los archivos de ' + date(chosen?.createdAt) + '. Los cambios posteriores a esa fecha se perderán. Se intentará crear una copia preventiva antes de continuar.', backup: 'La app entrará temporalmente en mantenimiento para crear una copia consistente y comprobar su restauración.', resume: 'Se comprobará la salud antes de abrir la aplicación. No se recuperarán datos automáticamente.', delete: 'Se eliminará esta copia cifrada de forma permanente.', 'restore-selective': 'Se reemplazarán únicamente los archivos privados seleccionados. Se creará una copia preventiva antes de continuar.' };
    if (!await ask('Confirmar ' + action, messages[action] || 'Se ejecutará esta operación sobre el entorno local.'))
        return;
    busy = true;
    render();
    try {
        const confirmation = await api('confirm', { action, target });
        await api('command', { action, target, confirmationId: confirmation.id, requestId: crypto.randomUUID() });
        error('');
        await refresh();
    }
    catch (e) {
        error(e.message);
    }
    finally {
        busy = false;
        render();
    }
}
// Keep unchanged regions mounted so refreshes preserve focus and selection.
const renderedRegions = new Map();
function region(id, value, draw) {
    const signature = JSON.stringify(value);
    if (renderedRegions.get(id) === signature)
        return;
    draw($(id));
    renderedRegions.set(id, signature);
}
function renderDiagnosis() {
    region('diagnosis', state.diagnosis?.services ?? null, diagnosis => {
        diagnosis.replaceChildren();
        for (const item of state.diagnosis?.services || []) {
            const row = node('div', undefined, 'row');
            row.append(node('span', item.name), node('span', item.status, 'badge'));
            diagnosis.append(row);
        }
        if (!state.diagnosis)
            diagnosis.append(node('p', 'Todavía no hay diagnóstico confirmado.', 'muted'));
    });
}
function renderOperation(op) {
    $('operation-title').textContent = op ? op.action + ' · ' + op.state : 'Sin operaciones';
    $('operation-detail').textContent = op?.error?.message || op?.phase || 'Las operaciones se registran antes de ejecutarse.';
    const recent = (op?.events || []).slice(-6);
    region('events', recent, events => {
        events.replaceChildren(...recent.map(event => node('p', date(event.at) + ' · ' + event.message, 'muted')));
    });
    const cancellable = op?.state === 'running' && op.action === 'install' && ['queued', 'preflight', 'preparing'].includes(op.phase);
    region('cancel-slot', cancellable ? op.id : null, slot => {
        slot.replaceChildren();
        if (cancellable)
            slot.append(button('Cancelar preparación', 'cancel', { id: op.id }));
    });
}
function renderBackups(op) {
    region('backups', [state.backups, emergency, op?.error?.code], backups => {
        backups.replaceChildren();
        if (!state.backups.length)
            backups.append(node('p', 'Todavía no hay copias. Crea una y comprueba su restauración antes de actualizar.', 'muted'));
        for (const item of state.backups) {
            const row = node('article', undefined, 'row'), meta = node('div');
            meta.append(node('b', date(item.createdAt)), node('p', item.tag + ' · ' + Math.ceil(item.bytes / 1024 / 1024) + ' MiB · ' + (item.restoredAt ? 'Restauración comprobada' : 'Pendiente de verificar'), 'muted'), node('code', item.sha));
            const actions = node('div', undefined, 'actions');
            actions.append(button('Verificar', 'verify', { id: item.id }), button('Restaurar', 'restore', { id: item.id }), button('Restaurar archivos', 'restore-selective', { id: item.id }));
            if (emergency && op?.error?.code === 'preventive_backup_failed')
                actions.append(button('Restaurar sin copia preventiva', 'restore', { id: item.id, withoutPreventive: true }));
            if (!emergency)
                actions.append(button(item.protected ? 'Desproteger' : 'Proteger', 'protect', { id: item.id, protected: !item.protected }), button('Eliminar', 'delete', { id: item.id }));
            row.append(meta, actions);
            backups.append(row);
        }
    });
}
function renderVersion() {
    $('github').textContent = state.github ? (state.github.from === state.github.sha ? 'No hay commits nuevos.' : 'Candidato: ' + state.github.sha) + (state.github.stale ? ' · Información obsoleta' : '') : 'Consulta las versiones para detectar cambios.';
    region('checks', state.github?.checks ?? [], checks => {
        checks.replaceChildren(...(state.github?.checks || []).map(check => node('p', check.workflow + ' · ' + check.state, 'badge')));
    });
    const recent = (state.github?.commits || []).slice(-20);
    region('commits', recent, commits => {
        commits.replaceChildren(...recent.map(commit => node('p', commit.sha.slice(0, 8) + ' · ' + commit.message.split('\n')[0], 'muted')));
    });
}
function render() {
    if (!state)
        return;
    const destination = state.destinations?.[0];
    if (destination && !document.activeElement?.closest('#destination-form')) {
        $('destination-name').value = destination.name || '';
        $('destination-type').value = destination.type || 'folder';
        $('destination-path').value = destination.path || destination.endpoint || '';
    }
    $('summary').textContent = state.maintenance.maintenance ? 'El entorno está en mantenimiento' : 'La aplicación está disponible';
    $('recommendation').textContent = state.recommendation?.reason || 'Las recuperaciones se ofrecerán cuando exista una copia comprobada compatible.';
    renderDiagnosis();
    renderOperation(state.operation);
    renderBackups(state.operation);
    renderVersion();
    region('history', state.history, history => {
        history.replaceChildren(...state.history.map(entry => node('div', date(entry.startedAt) + ' · ' + entry.action + ' · ' + entry.state, 'row')));
    });
    for (const el of document.querySelectorAll('[data-action],#enroll,#revoke,#policy-form button,#destination-form button'))
        el.disabled = busy || state.operation?.state === 'running';
    for (const el of document.querySelectorAll('[data-operation-action]'))
        el.disabled = busy;
    for (const id of ['updates', 'credentials', 'policy', 'destination'])
        $(id).hidden = emergency;
    if (document.activeElement?.closest('#policy-form') === null) {
        $('daily').checked = state.policy.daily;
        $('daily-retention').value = state.policy.dailyRetention;
        $('weekly-retention').value = state.policy.weeklyRetention || 4;
        $('update-retention').value = state.policy.updateRetention;
    }
}
async function refresh() {
    if (!token)
        return;
    try {
        state = await api('state');
        render();
    }
    catch (e) {
        error(e.message);
    }
}
async function login(body) {
    const result = await api('login', body);
    token = result.token;
    emergency = result.emergency;
    $('login').hidden = true;
    $('content').hidden = false;
    $('logout').hidden = false;
    $('code').value = '';
    error('');
    await refresh();
}
$('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
        await login({ code: $('code').value });
    }
    catch (e) {
        $('code').value = '';
        error(e.message);
    }
});
$('logout').addEventListener('click', async () => {
    try {
        await api('logout', {});
    }
    finally {
        token = null;
        location.reload();
    }
});
$('refresh').addEventListener('click', refresh);
for (const el of document.querySelectorAll('[data-action]'))
    el.addEventListener('click', () => command(el.dataset.action));
$('enroll').addEventListener('click', async () => {
    if (!await ask('Generar códigos', 'Los códigos anteriores dejarán de funcionar. Guarda los nuevos fuera de la app.'))
        return;
    try {
        const result = await api('enroll', {});
        $('codes').hidden = false;
        $('codes').textContent = result.codes.join('\n');
        $('codes-help').hidden = false;
        await refresh();
    }
    catch (e) {
        error(e.message);
    }
});
$('revoke').addEventListener('click', async () => {
    if (!await ask('Revocar acceso', 'Se revocarán tus códigos de emergencia y esta sesión de recuperación.'))
        return;
    try {
        await api('revoke', {});
        location.reload();
    }
    catch (e) {
        error(e.message);
    }
});
$('policy-form').addEventListener('submit', event => {
    event.preventDefault();
    const target = { daily: $('daily').checked, dailyRetention: Number($('daily-retention').value), weeklyRetention: Number($('weekly-retention').value), updateRetention: Number($('update-retention').value) };
    if ($('backup-dir').value)
        target.backupDir = $('backup-dir').value;
    command('policy', target);
});
$('destination-type').addEventListener('change', () => {
    document.querySelector('.destination-extra').hidden = $('destination-type').value !== 's3';
});
$('destination-form').addEventListener('submit', event => {
    event.preventDefault();
    const type = $('destination-type').value;
    command('destination', { id: state.destinations?.[0]?.id, name: $('destination-name').value, type, ...(type === 'folder' ? { path: $('destination-path').value } : { endpoint: $('destination-path').value, bucket: $('destination-bucket').value, region: $('destination-region').value, prefix: $('destination-prefix').value, accessKey: $('destination-access').value, secretKey: $('destination-secret').value }) });
});
$('destination-test').addEventListener('click', () => {
    const id = state.destinations?.[0]?.id;
    if (id)
        command('destination-test', { id });
});
$('destination-type').dispatchEvent(new Event('change'));
$('download').addEventListener('click', () => {
    if (!state)
        return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ controllerProtocol: state.controllerProtocol, diagnosis: state.diagnosis, operation: state.operation, history: state.history }, null, 2)], { type: 'application/json' }));
    const link = node('a');
    link.href = url;
    link.download = 'uvh-diagnostico.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener('message', async (event) => {
    if (event.origin !== location.origin || event.source !== window.opener || event.data?.type !== 'uvh-recovery-ticket')
        return;
    try {
        await login({ ticket: event.data.ticket });
        window.opener = null;
    }
    catch (e) {
        error(e.message);
    }
});
if (window.opener)
    window.opener.postMessage({ type: 'uvh-recovery-ready' }, location.origin);
async function poll() {
    await refresh();
    setTimeout(poll, 5000);
}
poll();
