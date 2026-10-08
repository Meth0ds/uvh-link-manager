import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, inject } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
export type Mode = 'start' | 'stop' | 'restart' | 'migrate' | 'repair-docker';
export interface Endpoint { url: string; status: 'ok' | 'slow' | 'error' | 'unavailable'; httpStatus: number | null; latencyMs: number; }
export interface Service { name: string; status: 'running' | 'stopped' | 'unknown'; detail: string; health: 'healthy' | 'unhealthy' | null; }
export interface Operation {
  id: string; requestId: string; mode: Mode; status: 'running' | 'succeeded' | 'failed' | 'timedOut' | 'unknown';
  phase: string; startedAt: string; finishedAt: string | null; output: string; error: string | null;
}
export interface Status {
  ok: true; schema: 1; checkedAt: string; text: string;
  docker: { status: string; version: string | null }; services: Service[];
  endpoints: { backend: Endpoint; frontend: Endpoint };
  migrations: { status: 'unknown' | 'pending' | 'current'; database: string; applied: number | null; pending: number | null };
  capabilities: { platform: string; repair: boolean; elevationRequired: boolean }; configured: boolean;
}
export interface State { operation: Operation | null; recentOperations: Operation[]; }
export interface Logs { text: string; checkedAt: string; truncated: boolean; }
export class PanelRejectedError extends Error {
  constructor(message: string, readonly status: number, cause: unknown) { super(message, { cause }); }
}
export class PanelNetworkError extends Error {
  constructor() { super('No se pudo contactar con el controlador local.'); }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Respuesta del controlador no válida.');
  return value as Record<string, unknown>;
}
function string(value: unknown): string { if (typeof value !== 'string') throw new Error('Texto API no válido.'); return value; }
function number(value: unknown): number { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Número API no válido.'); return value; }
function bool(value: unknown): boolean { if (typeof value !== 'boolean') throw new Error('Booleano API no válido.'); return value; }
function nullableString(value: unknown): string | null { return value === null ? null : string(value); }
function date(value: unknown): string { const text = string(value); if (!Number.isFinite(Date.parse(text))) throw new Error('Fecha API no válida.'); return text; }
function choice<T extends string>(value: unknown, values: readonly T[]): T { if (!values.includes(value as T)) throw new Error('Estado API no válido.'); return value as T; }
function endpoint(value: unknown): Endpoint {
  const body = record(value);
  return { url: string(body['url']), status: choice(body['status'], ['ok', 'slow', 'error', 'unavailable']),
    httpStatus: body['httpStatus'] === null ? null : number(body['httpStatus']), latencyMs: number(body['latencyMs']) };
}
function operation(value: unknown): Operation {
  const body = record(value);
  return { id: string(body['id']), requestId: string(body['requestId']), mode: choice(body['mode'], ['start', 'stop', 'restart', 'migrate', 'repair-docker']),
    status: choice(body['status'], ['running', 'succeeded', 'failed', 'timedOut', 'unknown']), phase: string(body['phase']),
    startedAt: date(body['startedAt']), finishedAt: body['finishedAt'] === null ? null : date(body['finishedAt']),
    output: string(body['output']), error: nullableString(body['error']) };
}
@Injectable({ providedIn: 'root' })
export class PanelApiService {
  private readonly http = inject(HttpClient);
  private readonly lifecycle = inject(DestroyRef);
  private token: string | null = null;
  private session: Promise<string> | null = null;
  private async getToken(): Promise<string> {
    if (this.token) return this.token;
    if (!this.session) {
      this.session = firstValueFrom(this.http.get<unknown>('/api/session').pipe(timeout(10000), takeUntilDestroyed(this.lifecycle)))
        .then((value) => { const body = record(value); if (body['ok'] !== true || body['schema'] !== 1) throw new Error('Sesión no válida.');
          const token = string(body['token']); if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Sesión no válida.'); this.token = token; return token; })
        .finally(() => { this.session = null; });
    }
    return this.session;
  }
  private async request(path: string, body?: object, retried = false): Promise<Record<string, unknown>> {
    try {
      const token = await this.getToken();
      const options = { headers: { 'X-UVH-Session': token } };
      const response = record(await firstValueFrom((body ? this.http.post<unknown>(path, body, options) : this.http.get<unknown>(path, options)).pipe(timeout(65000), takeUntilDestroyed(this.lifecycle))));
      if (response['ok'] !== true) throw new Error(typeof response['error'] === 'string' ? response['error'] : 'El controlador rechazó la solicitud.');
      return response;
    } catch (error) {
      if (error instanceof HttpErrorResponse) {
        // Un controlador reiniciado emite otra sesión: re-sesionar una vez en
        // silencio en lugar de mostrar un error que el siguiente sondeo curaría.
        // El 401 salta antes de admitir nada y el requestId es idempotente, así
        // que reintentar un POST no puede duplicar una operación.
        if (error.status === 401 && !retried && path !== '/api/session') {
          this.token = null;
          return this.request(path, body, true);
        }
        if (error.status === 401) this.token = null;
        if (error.status === 0) throw new PanelNetworkError();
        const value: unknown = error.error;
        const message = value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : `HTTP ${error.status}`;
        throw new PanelRejectedError(message, error.status, error);
      }
      if (error instanceof Error && error.name === 'TimeoutError') throw new PanelNetworkError();
      throw error;
    }
  }
  async status(): Promise<Status> {
    const body = await this.request('/api/status');
    if (body['schema'] !== 1 || !Array.isArray(body['services']) || body['services'].length > 20) throw new Error('Diagnóstico API no válido.');
    const docker = record(body['docker']), endpoints = record(body['endpoints']), migrations = record(body['migrations']), capabilities = record(body['capabilities']);
    return { ok: true, schema: 1, checkedAt: date(body['checkedAt']), text: string(body['text']),
      docker: { status: choice(docker['status'], ['running', 'unavailable', 'missing']), version: nullableString(docker['version']) },
      services: body['services'].map((value: unknown) => { const item = record(value); return { name: string(item['name']),
        status: choice(item['status'], ['running', 'stopped', 'unknown']), detail: string(item['detail']),
        health: item['health'] === null ? null : choice(item['health'], ['healthy', 'unhealthy'] as const) }; }),
      endpoints: { backend: endpoint(endpoints['backend']), frontend: endpoint(endpoints['frontend']) },
      migrations: { status: choice(migrations['status'], ['unknown', 'pending', 'current']), database: string(migrations['database']),
        applied: migrations['applied'] === null ? null : number(migrations['applied']), pending: migrations['pending'] === null ? null : number(migrations['pending']) },
      capabilities: { platform: string(capabilities['platform']), repair: bool(capabilities['repair']), elevationRequired: bool(capabilities['elevationRequired']) }, configured: bool(body['configured']) };
  }
  async state(): Promise<State> {
    const body = await this.request('/api/state');
    if (body['schema'] !== 1 || !Array.isArray(body['recentOperations']) || body['recentOperations'].length > 50) throw new Error('Historial API no válido.');
    return { operation: body['operation'] === null ? null : operation(body['operation']), recentOperations: body['recentOperations'].map(operation) };
  }
  async logs(target: 'backend' | 'frontend'): Promise<Logs> {
    const body = await this.request(`/api/logs?target=${target}`);
    return { text: string(body['text']), checkedAt: date(body['checkedAt']), truncated: bool(body['truncated']) };
  }
  async confirm(mode: Mode, destination: string): Promise<string> {
    const body = await this.request('/api/confirm', { mode, destination }); return string(body['confirmationId']);
  }
  async start(mode: Mode, requestId: string, confirmationId?: string): Promise<Operation> {
    return operation((await this.request('/api/op', { mode, requestId, ...(confirmationId ? { confirmationId } : {}) }))['operation']);
  }
}
