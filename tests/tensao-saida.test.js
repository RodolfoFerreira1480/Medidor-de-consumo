const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function backend() {
    const routes = {}, posts = {}, handlers = {}, queries = [], publishes = [];
    const app = { use() {}, get(url, cb) { routes[url] = cb; }, post(url, cb) { posts[url] = cb; }, listen() {} };
    const express = Object.assign(() => app, { json() {}, static() {} });
    const pool = { async query(sql, values) {
        queries.push({ sql, values });
        return { rows: sql.includes('SELECT valor') ? [{ valor: '1000' }] : [] };
    } };
    const mqtt = { connected: false, on(event, cb) { handlers[event] = cb; },
        publish(topic, message, options, callback) { publishes.push({ topic, message: JSON.parse(message), options }); callback(); } };
    const context = vm.createContext({
        require(name) {
            return { dotenv: { config() {} }, path, express, cors: () => {},
                mqtt: { connect: () => mqtt }, pg: { Pool: function () { return pool; } } }[name];
        }, __dirname: path.resolve(__dirname, '..'), process: { env: {} }, console: { log() {}, error() {} },
        setTimeout, clearTimeout,
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8'), context);
    return { context, routes, posts, handlers, queries, mqtt, publishes };
}

function response() {
    return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
}

async function telemetria(b, dados = { tensaoMaxima: 24, tensaoSaida: 12.5 }, packet = {}) {
    b.mqtt.connected = true;
    await b.handlers.message('smart-meter/medidor/dados', Buffer.from(JSON.stringify(dados)), packet);
}

test('máximo aceita aliases e números válidos, rejeita valores ausentes ou inválidos', () => {
    const { context: c } = backend();
    assert.equal(c.normalizarLeitura({ tensaoMaxima: 24 }).tensaoMaxima, 24);
    assert.equal(c.normalizarLeitura({ tensao_maxima: '24.5' }).tensaoMaxima, 24.5);
    for (const value of [undefined, null, '', ' ', 'abc', 0, -1, Infinity, true, [], {}]) {
        assert.equal(c.normalizarLeitura({ tensaoMaxima: value }).tensaoMaxima, null);
    }
});

test('controle envia zero, frações e máximo via MQTT sem alterar a tensão medida', async () => {
    const b = backend();
    await telemetria(b);
    for (const tensaoSaida of [0, 12.75, 24]) {
        const res = response();
        await b.posts['/api/tensao-saida']({ body: { tensaoSaida } }, res);
        assert.equal(res.code, 200);
        assert.equal(res.body.tensaoSolicitada, tensaoSaida);
        const envio = b.publishes.at(-1);
        assert.deepEqual(envio.message, { comando: 'ajustar_tensao', tensaoSaida });
        assert.equal(envio.topic, 'smart-meter/medidor/comando');
        assert.equal(envio.options.qos, 1);
        assert.equal(envio.options.retain, false);
    }
    const status = response();
    b.routes['/api/status']({}, status);
    assert.equal(status.body.tensaoSaida, 12.5);
    assert.equal(status.body.tensaoMaxima, 24);
    assert.equal(status.body.controleTensao.disponivel, true);
});

test('API rejeita entradas inválidas e revalida o máximo que diminuiu', async () => {
    const b = backend();
    await telemetria(b);
    for (const tensaoSaida of [undefined, null, '', ' ', true, [], {}, 'abc', -0.01, 24.01, Infinity]) {
        const res = response();
        await b.posts['/api/tensao-saida']({ body: { tensaoSaida } }, res);
        assert.equal(res.code, 400);
    }
    await telemetria(b, { tensaoMaxima: 10 });
    const res = response();
    await b.posts['/api/tensao-saida']({ body: { tensaoSaida: 12 } }, res);
    assert.equal(res.code, 400);
    assert.equal(b.publishes.length, 0);
});

test('sem telemetria, sem máximo, desconectado, retido e expirado bloqueiam o ajuste', async () => {
    const b = backend();
    async function bloqueado() {
        const res = response();
        await b.posts['/api/tensao-saida']({ body: { tensaoSaida: 5 } }, res);
        assert.equal(res.code, 503);
    }
    await bloqueado();
    await telemetria(b, { tensaoSaida: 12 });
    await bloqueado();
    await telemetria(b);
    b.mqtt.connected = false;
    await bloqueado();
    await telemetria(b, { tensaoMaxima: 24 }, { retain: true });
    await bloqueado();
    await telemetria(b);
    vm.runInContext('ultimoEstado.timestampLeitura = new Date(Date.now() - 16000)', b.context);
    await b.handlers.message('smart-meter/medidor/alerta', Buffer.from('Alerta recente'));
    await bloqueado();
    await telemetria(b);
    b.handlers.close();
    await bloqueado();
    assert.equal(b.publishes.length, 0);
});

test('falha MQTT e envio simultâneo retornam erro; comandos existentes são preservados', async () => {
    const b = backend();
    await telemetria(b);
    let confirmar;
    b.mqtt.publish = (topic, message, options, cb) => { confirmar = cb; };
    const primeira = response();
    const pendente = b.posts['/api/tensao-saida']({ body: { tensaoSaida: 12 } }, primeira);
    const segunda = response();
    await b.posts['/api/tensao-saida']({ body: { tensaoSaida: 10 } }, segunda);
    assert.equal(segunda.code, 409);
    confirmar(new Error('Sem conexão'));
    await pendente;
    assert.equal(primeira.code, 503);
    b.mqtt.publish = (topic, message, options, cb) => { b.publishes.push(JSON.parse(message)); cb(); };
    for (const acao of ['ligar', 'desligar']) {
        const res = response();
        await b.posts['/api/comando']({ body: { acao } }, res);
        assert.equal(res.code, 200);
        assert.deepEqual(b.publishes.at(-1), { comando: acao });
    }
    const res = response();
    await b.posts['/api/tensao-saida']({ body: { tensaoSaida: 10 } }, res);
    assert.equal(res.code, 200);
});

test('broker sem confirmação não mantém a API bloqueada indefinidamente', async () => {
    const b = backend();
    await telemetria(b);
    let expirar;
    b.context.setTimeout = callback => { expirar = callback; return {}; };
    b.context.clearTimeout = () => {};
    b.mqtt.publish = () => {};
    const res = response();
    const pendente = b.posts['/api/tensao-saida']({ body: { tensaoSaida: 12 } }, res);
    expirar();
    await pendente;
    assert.equal(res.code, 503);
    assert.match(res.body.erro, /sem confirmação/);
    b.mqtt.publish = (topic, message, options, cb) => cb();
    const novo = response();
    await b.posts['/api/tensao-saida']({ body: { tensaoSaida: 10 } }, novo);
    assert.equal(novo.code, 200);
});

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
