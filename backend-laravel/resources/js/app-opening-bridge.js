/* First-party bridge. The grant stays in memory and is never sent in a URL. */
(() => {
  const language = document.documentElement.lang === 'en-GB' ? 'en' : 'es';
  const messages = {
    es: {
      invalid: 'Este acceso no es válido. Vuelve a abrir el enlace original.',
      ready: 'La aplicación no se ha abierto. Puedes continuar con la alternativa web.',
      expired: 'El acceso ha cambiado o ha caducado. Vuelve a abrir el enlace original.',
    },
    en: {
      invalid: 'This access is not valid. Please open the original link again.',
      ready: 'The app has not opened. You can continue with the web alternative.',
      expired: 'Access has changed or expired. Please open the original link again.',
    },
  }[language];
  const grant = new URLSearchParams(location.hash.slice(1)).get('grant');
  history.replaceState(null, '', location.pathname + location.search);
  const status = document.getElementById('status');
  const button = document.getElementById('continue');
  const profileId = document.querySelector('main').dataset.profile;
  const attemptId = crypto.randomUUID();
  const body = { launchUrl: location.href, profileId, attemptId, grant };
  let challenge;
  async function resolve() {
    const response = await fetch('/api/v1/app-links/resolve', {
      method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Language': language === 'en' ? 'en-GB' : 'es-ES' },
      body: JSON.stringify({ ...body, challenge }),
    });
    const result = await response.json();
    if (result.kind === 'challenge_required' && !challenge) {
      challenge = result.challenge;
      return resolve();
    }
    if (!response.ok || !['content', 'web'].includes(result.kind)) throw new Error('unavailable');
    const target = new URL(result.webUrl);
    if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) throw new Error('url');
    return target.href;
  }
  if (!grant || grant.length > 4096) {
    status.textContent = messages.invalid;
    return;
  }
  resolve().then(() => {
    status.textContent = messages.ready;
    button.disabled = false;
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { location.replace(await resolve()); }
      catch { status.textContent = messages.expired; }
    });
  }).catch(() => { status.textContent = messages.expired; });
})();
