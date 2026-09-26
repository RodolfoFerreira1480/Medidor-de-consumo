const assert = require('node:assert/strict');
const test = require('node:test');
const { criarServicoTarifas, registrarRotasTarifas } = require('../lib/tarifas');

function criarCatalogo() {
    return {
        atualizadoEm: '2026-09-25',
        estados: [{ sigla: 'SP', nome: 'São Paulo' }, { sigla: 'RJ', nome: 'Rio de Janeiro' }],
        municipios: [
            { codigo: '3500001', nome: 'Cidade Compartilhada', uf: 'SP', distribuidoras: ['paulista-a', 'paulista-b', 'futura'] },
            { codigo: '3500002', nome: 'Cidade Exclusiva', uf: 'SP', distribuidoras: ['paulista-a'] },
            { codigo: '3300001', nome: 'Cidade Fluminense', uf: 'RJ', distribuidoras: ['fluminense'] },
        ],
        distribuidoras: [
            { id: 'paulista-a', nome: 'Energia Paulista A', ufs: ['SP'], tarifas: [
                { inicioVigencia: '2026-08-25', fimVigencia: '2026-09-24', valorKWh: 0.6 },
                { inicioVigencia: '2026-09-25', fimVigencia: '2026-10-24', valorKWh: 0.8 },
                { inicioVigencia: '2026-10-25', fimVigencia: '2026-11-24', valorKWh: 0.9 },
            ] },
            { id: 'paulista-b', nome: 'Energia Paulista B', ufs: ['SP'], tarifas: [
                { inicioVigencia: '2026-09-01', fimVigencia: '2026-09-30', valorKWh: 0.95 },
            ] },
            { id: 'fluminense', nome: 'Energia Fluminense', ufs: ['RJ'], tarifas: [
                { inicioVigencia: '2026-09-01', fimVigencia: '2026-10-31', valorKWh: 0.75 },
            ] },
            { id: 'futura', nome: 'Energia Futura', ufs: ['SP'], tarifas: [
                { inicioVigencia: '2026-12-01', fimVigencia: '2026-12-31', valorKWh: 0.7 },
            ] },
        ],
    };
}

function criarServico(instante = '2026-09-25T15:00:00Z') {
    return criarServicoTarifas(criarCatalogo(), () => new Date(instante));
}

function selecaoLocalidade(alteracoes = {}) {
    return { modo: 'localidade', uf: 'SP', municipio: '3500001', distribuidoraId: 'paulista-a', ...alteracoes };
}

function erroDeEntrada(acao) {
    assert.throws(acao, erro => erro.status === 400 && typeof erro.message === 'string' && erro.message.length > 0);
}

function criarResposta() {
    return {
        statusCode: 200,
        headers: {},
        body: undefined,
        status(codigo) { this.statusCode = codigo; return this; },
        set(nome, valor) { this.headers[nome] = valor; return this; },
        json(body) { this.body = body; return this; },
    };
}

function criarApp(pool, instante = '2026-09-25T15:00:00Z') {
    const rotas = new Map();
    const app = {
        get(caminho, handler) { rotas.set(`GET ${caminho}`, handler); },
        post(caminho, handler) { rotas.set(`POST ${caminho}`, handler); },
    };
    registrarRotasTarifas(app, pool, { catalogo: criarCatalogo(), agora: () => new Date(instante) });
    return {
        handler(metodo, caminho) {
            const handler = rotas.get(`${metodo} ${caminho}`);
            assert.equal(typeof handler, 'function', `Rota ausente: ${metodo} ${caminho}`);
            return handler;
        },
        async solicitar(metodo, caminho, req = {}) {
            const res = criarResposta();
            await this.handler(metodo, caminho)(req, res);
            return res;
        },
    };
}

function criarBanco(valorInicial = null) {
    return {
        valor: valorInicial,
        chamadas: [],
        falhar: false,
        async query(sql, parametros) {
            this.chamadas.push({ sql, parametros });
            if (this.falhar) throw new Error('Banco indisponível');
            if (/^SELECT\b/i.test(sql.trim())) return { rows: this.valor === null ? [] : [{ valor: this.valor }] };
            assert.equal(parametros.length, 1);
            assert.equal(typeof parametros[0], 'string');
            JSON.parse(parametros[0]);
            this.valor = parametros[0];
            return { rows: [] };
        },
    };
}

test('localidade exige UF conhecida e cidade pertencente à UF selecionada', () => {
    const servico = criarServico();
    for (const uf of [undefined, '', 'XX', 'sp', true, ['SP']]) {
        erroDeEntrada(() => servico.listarMunicipios(uf));
        erroDeEntrada(() => servico.listarDistribuidoras(uf));
        erroDeEntrada(() => servico.normalizarConfiguracao(selecaoLocalidade({ uf })));
    }
    for (const municipio of ['9999999', '3300001', 3500001, true, ['3500001']]) {
        erroDeEntrada(() => servico.listarDistribuidoras('SP', municipio));
        erroDeEntrada(() => servico.normalizarConfiguracao(selecaoLocalidade({ municipio })));
    }
});

test('cidade é opcional e seleção estadual mantém a distribuidora escolhida', () => {
    const servico = criarServico();
    for (const municipio of [undefined, null, '']) {
        assert.deepEqual(servico.listarDistribuidoras('SP', municipio).distribuidoras.map(item => item.id), ['paulista-a', 'paulista-b']);
        const resultado = servico.resolverConfiguracao(selecaoLocalidade({ municipio, distribuidoraId: 'paulista-b' }));
        assert.equal(resultado.configuracao.municipio, null);
        assert.equal(resultado.configuracao.distribuidoraId, 'paulista-b');
        assert.equal(resultado.tarifa.valorKWh, 0.95);
    }
});

test('cidade com múltiplas distribuidoras oferece todas as opções vigentes', () => {
    const servico = criarServico();
    const opcoes = servico.listarDistribuidoras('SP', '3500001').distribuidoras;
    assert.deepEqual(opcoes.map(item => item.id), ['paulista-a', 'paulista-b']);
    assert.deepEqual(opcoes.map(item => item.tarifaKWh), [0.8, 0.95]);
    assert.equal(servico.resolverConfiguracao(selecaoLocalidade({ distribuidoraId: 'paulista-b' })).tarifa.valorKWh, 0.95);
    assert.deepEqual(servico.listarDistribuidoras('SP', '3500002').distribuidoras.map(item => item.id), ['paulista-a']);
});

test('distribuidora precisa atender o estado e a cidade informados', () => {
    const servico = criarServico();
    for (const dados of [
        selecaoLocalidade({ distribuidoraId: 'inexistente' }),
        selecaoLocalidade({ distribuidoraId: 'fluminense' }),
        selecaoLocalidade({ municipio: '3500002', distribuidoraId: 'paulista-b' }),
        selecaoLocalidade({ municipio: null, distribuidoraId: 'fluminense' }),
    ]) erroDeEntrada(() => servico.normalizarConfiguracao(dados));
});

test('seleção automática usa o catálogo e ignora o preço enviado pelo cliente', () => {
    const resultado = criarServico().resolverConfiguracao(selecaoLocalidade({ valorKWh: 0.000001, tarifaKWh: 99 }));
    assert.equal(resultado.tarifa.valorKWh, 0.8);
    assert.equal(resultado.tarifa.origem, 'aneel');
    assert.equal(resultado.configuracao.valorKWh, null);
    assert.equal(Object.hasOwn(resultado.configuracao, 'tarifaKWh'), false);
});

test('vigência inclui início e fim e muda à meia-noite de São Paulo', () => {
    const cenarios = [
        ['2026-09-25T02:59:59Z', 0.6],
        ['2026-09-25T03:00:00Z', 0.8],
        ['2026-10-25T02:59:59Z', 0.8],
        ['2026-10-25T03:00:00Z', 0.9],
    ];
    for (const [instante, valorEsperado] of cenarios) {
        const resultado = criarServico(instante).resolverConfiguracao(selecaoLocalidade());
        assert.equal(resultado.tarifa.valorKWh, valorEsperado, instante);
    }
});

test('tarifas futuras e vencidas não podem ser selecionadas', () => {
    const servico = criarServico();
    erroDeEntrada(() => servico.normalizarConfiguracao(selecaoLocalidade({ distribuidoraId: 'futura' })));
    const expirado = criarServico('2027-01-01T15:00:00Z');
    assert.deepEqual(expirado.listarDistribuidoras('SP', '3500001').distribuidoras, []);
    erroDeEntrada(() => expirado.normalizarConfiguracao(selecaoLocalidade()));
});

test('configuração salva expirada retorna tarifa nula para impedir custo desatualizado', () => {
    const resultado = criarServico('2027-01-01T15:00:00Z').resolverConfiguracao(selecaoLocalidade());
    assert.equal(resultado.configuracao, null);
    assert.equal(resultado.tarifa, null);
    assert.equal(typeof resultado.aviso, 'string');
    assert.ok(resultado.aviso.length > 0);
});

test('tarifa manual aceita valores positivos até 100 com seis casas decimais', () => {
    const servico = criarServico();
    for (const valorKWh of [0.000001, 0.123456, 0.8, 1.234567, 100]) {
        const resultado = servico.resolverConfiguracao({ modo: 'manual', valorKWh, uf: 'XX', municipio: '999', distribuidoraId: 'inexistente' });
        assert.deepEqual(resultado.configuracao, { modo: 'manual', valorKWh, uf: null, municipio: null, distribuidoraId: null });
        assert.equal(resultado.tarifa.valorKWh, valorKWh);
        assert.equal(resultado.tarifa.origem, 'manual');
    }
});

test('tarifa manual rejeita zero, negativos, coerções, valores não finitos e precisão excessiva', () => {
    const servico = criarServico();
    const invalidos = [0, -1, true, false, '', '0.8', null, undefined, NaN, Infinity, -Infinity, [], [0.8], {}, 100.000001, 0.1234567];
    for (const valorKWh of invalidos) erroDeEntrada(() => servico.normalizarConfiguracao({ modo: 'manual', valorKWh }));
    for (const dados of [null, undefined, [], [{ modo: 'manual', valorKWh: 1 }], 'manual', {}, { modo: 'desconhecido' }]) {
        erroDeEntrada(() => servico.normalizarConfiguracao(dados));
    }
});

test('GETs expõem estados, municípios filtrados e distribuidoras sem consultar o banco', async () => {
    const banco = criarBanco();
    const app = criarApp(banco);
    const estados = await app.solicitar('GET', '/api/tarifas/estados');
    assert.equal(estados.statusCode, 200);
    assert.deepEqual(estados.body.estados.map(item => item.sigla), ['SP', 'RJ']);
    assert.equal(estados.body.atualizadoEm, '2026-09-25');
    assert.match(estados.body.fonte.url, /^https:\/\//);
    const municipios = await app.solicitar('GET', '/api/tarifas/municipios', { query: { uf: 'RJ' } });
    assert.deepEqual(municipios.body.municipios, [{ codigo: '3300001', nome: 'Cidade Fluminense' }]);
    const distribuidoras = await app.solicitar('GET', '/api/tarifas/distribuidoras', { query: { uf: 'SP', municipio: '3500001' } });
    assert.deepEqual(distribuidoras.body.distribuidoras.map(item => item.id), ['paulista-a', 'paulista-b']);
    assert.equal(banco.chamadas.length, 0);
});

test('GETs rejeitam UF e cidade inválidas com 400', async () => {
    const app = criarApp(criarBanco());
    for (const [caminho, query] of [
        ['/api/tarifas/municipios', {}],
        ['/api/tarifas/municipios', { uf: 'XX' }],
        ['/api/tarifas/distribuidoras', { uf: 'SP', municipio: '3300001' }],
    ]) {
        const res = await app.solicitar('GET', caminho, { query });
        assert.equal(res.statusCode, 400);
        assert.equal(typeof res.body.erro, 'string');
    }
});

test('GET sem tarifa salva retorna configuração e tarifa nulas sem cache', async () => {
    const res = await criarApp(criarBanco()).solicitar('GET', '/api/config/tarifa');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.configuracao, null);
    assert.equal(res.body.tarifa, null);
    assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('POST persiste configuração normalizada como JSON e GET a recupera', async () => {
    const banco = criarBanco();
    const app = criarApp(banco);
    const post = await app.solicitar('POST', '/api/config/tarifa', { body: selecaoLocalidade({ valorKWh: 77, inesperado: 'descartar' }) });
    assert.equal(post.statusCode, 200);
    assert.equal(post.body.tarifa.valorKWh, 0.8);
    assert.deepEqual(JSON.parse(banco.valor), { modo: 'localidade', uf: 'SP', municipio: '3500001', distribuidoraId: 'paulista-a', valorKWh: null });
    const get = await app.solicitar('GET', '/api/config/tarifa');
    assert.deepEqual(get.body, post.body);
});

test('POST manual persiste o preço e ele continua válido após vencimento do catálogo', async () => {
    const banco = criarBanco();
    const post = await criarApp(banco).solicitar('POST', '/api/config/tarifa', { body: { modo: 'manual', valorKWh: 1.234567 } });
    assert.equal(post.statusCode, 200);
    assert.equal(JSON.parse(banco.valor).valorKWh, 1.234567);
    const get = await criarApp(banco, '2027-01-01T15:00:00Z').solicitar('GET', '/api/config/tarifa');
    assert.equal(get.body.tarifa.valorKWh, 1.234567);
    assert.equal(get.body.tarifa.origem, 'manual');
});

test('POST só responde sucesso depois que o banco confirma a gravação', async () => {
    let confirmarGravacao;
    const gravacao = new Promise(resolve => { confirmarGravacao = resolve; });
    let chamada = false;
    const app = criarApp({ query() { chamada = true; return gravacao; } });
    const res = criarResposta();
    const pendente = app.handler('POST', '/api/config/tarifa')({ body: { modo: 'manual', valorKWh: 0.8 } }, res);
    assert.equal(chamada, true);
    await Promise.resolve();
    assert.equal(res.body, undefined);
    confirmarGravacao({ rows: [] });
    await pendente;
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.tarifa.valorKWh, 0.8);
});

test('POST inválido não escreve no banco nem altera a configuração anterior', async () => {
    const anterior = JSON.stringify({ modo: 'manual', valorKWh: 0.8 });
    const banco = criarBanco(anterior);
    const app = criarApp(banco);
    for (const body of [{ modo: 'manual', valorKWh: 0 }, selecaoLocalidade({ distribuidoraId: 'fluminense' })]) {
        const res = await app.solicitar('POST', '/api/config/tarifa', { body });
        assert.equal(res.statusCode, 400);
    }
    assert.equal(banco.chamadas.length, 0);
    assert.equal(banco.valor, anterior);
});

test('falha de leitura retorna 503 sem inventar uma tarifa', async () => {
    const banco = criarBanco();
    banco.falhar = true;
    const res = await criarApp(banco).solicitar('GET', '/api/config/tarifa');
    assert.equal(res.statusCode, 503);
    assert.equal(typeof res.body.erro, 'string');
    assert.equal(Object.hasOwn(res.body, 'tarifa'), false);
});

test('falha de gravação retorna 503 e a configuração anterior permanece recuperável', async () => {
    const anterior = JSON.stringify({ modo: 'manual', valorKWh: 0.8 });
    const banco = criarBanco(anterior);
    const app = criarApp(banco);
    banco.falhar = true;
    const post = await app.solicitar('POST', '/api/config/tarifa', { body: { modo: 'manual', valorKWh: 1.2 } });
    assert.equal(post.statusCode, 503);
    assert.equal(typeof post.body.erro, 'string');
    assert.equal(banco.valor, anterior);
    banco.falhar = false;
    const get = await app.solicitar('GET', '/api/config/tarifa');
    assert.equal(get.body.tarifa.valorKWh, 0.8);
});

test('GET de configuração vencida ou JSON inválido exige nova escolha e retorna tarifa nula', async () => {
    for (const valor of [JSON.stringify(selecaoLocalidade()), '{json quebrado', JSON.stringify({ modo: 'manual', valorKWh: -1 })]) {
        const res = await criarApp(criarBanco(valor), '2027-01-01T15:00:00Z').solicitar('GET', '/api/config/tarifa');
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.tarifa, null);
        assert.equal(res.body.configuracao, null);
        assert.ok(res.body.aviso.length > 0);
    }
});
