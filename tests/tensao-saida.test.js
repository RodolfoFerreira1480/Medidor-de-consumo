const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function backend() {
    const routes = {}, handlers = {}, queries = [];
    const app = { use() {}, get(url, cb) { routes[url] = cb; }, post() {}, listen() {} };
    const express = Object.assign(() => app, { json() {}, static() {} });
    const pool = { async query(sql, values) {
        queries.push({ sql, values });
        return { rows: sql.includes('SELECT valor') ? [{ valor: '1000' }] : [] };
    } };
    const mqtt = { connected: false, on(event, cb) { handlers[event] = cb; } };
    const context = vm.createContext({
        require(name) {
            return { dotenv: { config() {} }, path, express, cors: () => {},
                mqtt: { connect: () => mqtt }, pg: { Pool: function () { return pool; } } }[name];
        }, __dirname: path.resolve(__dirname, '..'), process: { env: {} }, console: { log() {}, error() {} },
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8'), context);
    return { context, routes, handlers, queries };
}

test('banco usa URL no Render, TLS no Supabase e rejeita host ausente em producao', () => {
    const { context: c } = backend();
    assert.throws(() => c.configurarBanco({ RENDER: 'true' }), /Configure DATABASE_URL/);
    const url = 'postgresql://usuario:senha@aws-0-region.pooler.supabase.com:5432/postgres';
    const remoto = c.configurarBanco({ RENDER: 'true', DATABASE_URL: url, DB_HOST: 'localhost' });
    assert.equal(remoto.connectionString, url);
    assert.equal(remoto.host, undefined);
    assert.equal(remoto.ssl.rejectUnauthorized, true);
    const separado = c.configurarBanco({ DB_HOST: 'db.exemplo.supabase.co', DB_USER: 'postgres' });
    assert.equal(separado.host, 'db.exemplo.supabase.co');
    assert.equal(separado.ssl.rejectUnauthorized, true);
    const local = c.configurarBanco({ DB_HOST: 'localhost' });
    assert.equal(local.ssl, false);
    assert.equal(local.port, 5432);
});

test('normaliza saida, distingue zero de ausencia e preserva payload antigo', () => {
    const { context: c } = backend();
    assert.equal(c.normalizarLeitura({ tensao: 24, tensaoSaida: 12, corrente: 2 }).potencia, 24);
    assert.equal(c.normalizarLeitura({ tensao: 24, corrente: 2 }).potencia, 48);
    assert.equal(c.normalizarLeitura({ tensao: 24, tensaoSaida: 0, corrente: 2 }).potencia, 0);
    assert.equal(c.normalizarLeitura({ tensao_saida: '12.5' }).tensaoSaida, 12.5);
    assert.equal(c.normalizarLeitura({ tensaoSaida: 12, corrente: 2, potencia: 23 }).potencia, 23);
    for (const value of [undefined, null, '', ' ', 'invalida', -1, Infinity, true]) {
        assert.equal(c.normalizarLeitura({ tensaoSaida: value }).tensaoSaida, null);
    }
});

test('mensagem MQTT chega ao status e ao INSERT; migracao preserva leituras antigas', async () => {
    const b = backend();
    await b.context.inicializarBanco();
    assert(b.queries.some(q => q.sql.includes('ADD COLUMN IF NOT EXISTS tensao_saida DOUBLE PRECISION')));
    await b.handlers.message('smart-meter/medidor/dados', Buffer.from(JSON.stringify({ tensao: 24, tensaoSaida: 12.5, corrente: 2 })));
    let status;
    b.routes['/api/status']({}, { json(value) { status = value; } });
    assert.equal(status.tensaoSaida, 12.5);
    assert.equal(status.potencia, 25);
    const insert = b.queries.find(q => q.sql.includes('INSERT INTO historico'));
    assert.equal(insert.values[4], 12.5);
    await b.routes['/api/historico']({}, { json() {} });
    assert(b.queries.some(q => q.sql.includes('tensao_saida AS "tensaoSaida"')));
});

test('painel exibe saida recebida, zero real e ausencia sem reutilizar leitura antiga', async () => {
    const html = fs.readFileSync(path.join(__dirname, '../front-end/index.html'), 'utf8');
    const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, {
        innerHTML: '', classList: { toggle() {} }, getContext() {},
    }]));
    function Chart(ctx, config) { Object.assign(this, config); this.update = () => {}; }
    Chart.defaults = { font: {}, plugins: { legend: {} } };
    let status = { tensao: 24, tensaoSaida: 12.5 };
    const c = vm.createContext({ Chart, window: { location: { protocol: 'http:' } },
        document: { getElementById: id => elements.get(id) },
        fetch: async () => ({ ok: true, json: async () => status }),
        setInterval() {}, lucide: { createIcons() {} }, console,
    });
    const script = fs.readFileSync(path.join(__dirname, '../front-end/script.js'), 'utf8').replace('iniciarPainel();', '');
    vm.runInContext(script, c);
    await c.atualizarDados();
    assert.match(elements.get('val-tensao-saida').innerHTML, /12,5/);
    assert.match(elements.get('val-tensao').innerHTML, /24/);
    status.tensaoSaida = 0;
    await c.atualizarDados();
    assert.match(elements.get('val-tensao-saida').innerHTML, /^0 /);
    delete status.tensaoSaida;
    await c.atualizarDados();
    assert.match(elements.get('val-tensao-saida').innerHTML, /^— /);
});
