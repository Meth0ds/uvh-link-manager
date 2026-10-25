const $ = id => document.getElementById(id);
const date = value => value ? new Date(value).toLocaleString('es-ES') : 'Por confirmar';
const phases = { queued: 'Preparando la operación', checking: 'Comprobando requisitos', preflight: 'Comprobando requisitos', preparing: 'Preparando la nueva versión', maintenance: 'Protegiendo el servicio', quiescing: 'Deteniendo las escrituras', backing_up: 'Protegiendo los datos', backup: 'Protegiendo los datos', verifying_backup: 'Comprobando la recuperación', applying: 'Aplicando la actualización', migrating: 'Aplicando migraciones', restoring: 'Recuperando el servicio', validating: 'Realizando las comprobaciones finales' };
async function poll() {
    try {
        const response = await fetch('/__uvh/status', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
        if (!response.ok)
            throw Error();
        const state = await response.json();
        $('since').textContent = date(state.since);
        $('updated').textContent = date(state.updatedAt);
        $('phase').textContent = phases[state.phase] || 'Comprobando la disponibilidad';
        $('connection').textContent = 'Información actualizada automáticamente.';
        if (state.available) {
            $('title').textContent = 'Todo está preparado.';
            $('message').textContent = 'La aplicación vuelve a estar disponible. Puedes continuar donde lo dejaste.';
            $('status').textContent = 'Servicio disponible';
            $('return').textContent = 'Volver a la aplicación';
        }
        else if (state.reason === 'recovery') {
            $('title').textContent = 'Estamos recuperando el servicio.';
            $('message').textContent = 'Estamos restaurando una copia y comprobando que todo funciona antes de volver a abrir.';
        }
        else if (state.reason === 'incident') {
            $('title').textContent = 'Estamos revisando el servicio.';
            $('message').textContent = 'Hemos detectado una incidencia. La aplicación volverá a estar disponible cuando las comprobaciones lo permitan.';
        }
        else if (state.reason === 'backup') {
            $('title').textContent = 'Estamos protegiendo tus datos.';
            $('message').textContent = 'Estamos creando y verificando una copia de seguridad consistente.';
        }
    }
    catch {
        $('connection').textContent = 'No se ha podido actualizar el estado. Se conserva la última información confirmada.';
    }
    setTimeout(poll, 10000);
}
poll();
